import van from "vanjs-core"

import { syncCommand } from "../api/sync.ts"
import { runDownloads } from "../sync/download.ts"
import { type FullScanState, advanceFullScan } from "../sync/full-scan.ts"
import { runIncrementalReconciliation } from "../sync/incremental.ts"
import { SyncWorker, type SyncWorkerKind } from "../sync/worker.ts"
import { auth } from "./auth.ts"
import { serverSettings } from "./settings.ts"

const HEARTBEAT_INTERVAL_MS = 20_000
const SYNC_POLL_INTERVAL_MS = 15_000
const SYNC_POLL_JITTER_MS = 3_000

export type SyncStatus = {
    reconciliationPaused: boolean
    downloadsPaused: boolean
    budget: number
    baseline: number | null
    active: number
    downloaded: number
    archived: number
    deleted: number
    pending: number
    run: { id: number; status: string; checkpoint: number; message: string | null } | null
}

export const syncStatus = van.state<SyncStatus | null>(null)
export const syncError = van.state("")

const runningWorkers = new Set<SyncWorkerKind>()

export async function syncControl(
    action: string,
    data: Record<string, unknown> = {},
): Promise<void> {
    await syncCommand(action, data)
    await refreshStatus()
}

async function refreshStatus(): Promise<void> {
    syncStatus.val = await syncCommand<SyncStatus>("status")
}

async function runWorker(kind: SyncWorkerKind): Promise<void> {
    if (runningWorkers.has(kind)) return
    runningWorkers.add(kind)

    let worker: SyncWorker | null = null
    let heartbeat: ReturnType<typeof setInterval> | undefined

    try {
        worker = await SyncWorker.acquire(kind)
        if (worker === null) return

        heartbeat = startHeartbeat(worker)
        if (kind === "download") {
            await runDownloads(worker)
        } else {
            await runReconciliation(worker)
        }
    } catch (error) {
        syncError.val = String(error)
    } finally {
        if (heartbeat !== undefined) clearInterval(heartbeat)
        if (worker?.isCurrent()) await worker.release().catch(() => {})

        runningWorkers.delete(kind)
    }
}

async function runReconciliation(worker: SyncWorker): Promise<void> {
    for (;;) {
        const state = await worker.command<FullScanState>("start")
        if (state.runId === null) break

        try {
            await advanceFullScan(worker, state)
        } catch (error) {
            await worker.command("run-error", {
                runId: state.runId,
                value: String(error),
            })
            throw error
        }
    }

    await runIncrementalReconciliation(worker)
}

function startHeartbeat(worker: SyncWorker): ReturnType<typeof setInterval> {
    return setInterval(() => {
        if (!worker.isCurrent() || worker.hasStalled()) {
            worker.stop()
            return
        }

        void worker.renew().catch(() => worker.stop())
    }, HEARTBEAT_INTERVAL_MS)
}

async function scheduleWork(): Promise<void> {
    if (!serverSettings.rawVal.enabled || auth.rawVal.status !== "authenticated") return

    try {
        await refreshStatus()
        syncError.val = ""

        // Reconciliation and media downloads have independent leases and may
        // make progress alongside each other.
        if (!syncStatus.rawVal?.reconciliationPaused) void runWorker("reconciliation")
        if (!syncStatus.rawVal?.downloadsPaused) void runWorker("download")
    } catch (error) {
        syncError.val = String(error)
    }
}

setInterval(() => void scheduleWork(), SYNC_POLL_INTERVAL_MS + Math.random() * SYNC_POLL_JITTER_MS)

// Changing account or server settings invalidates current workers and asks the
// new context to acquire its own leases immediately.
van.derive(() => {
    serverSettings.val
    auth.val
    void scheduleWork()
})

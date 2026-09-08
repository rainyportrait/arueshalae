import van from "vanjs-core"

import { syncCommand } from "../api/sync.ts"
import { drainDownloads } from "../sync/download.ts"
import { runFullScan } from "../sync/full-scan.ts"
import { runIncremental } from "../sync/incremental.ts"
import { Rule34Reader } from "../sync/rule34.ts"
import { auth } from "./auth.ts"
import { serverSettings } from "./settings.ts"

const POLL_INTERVAL_MS = 15_000

export type SyncStatus = {
    configured: true
    active: number
    downloaded: number
    archived: number
    deleted: number
    pending: number
    baselineCount: number
    baselineReady: boolean
    countOffset: number
    budget: number
    incrementalPaused: boolean
    downloadsPaused: boolean
    lastIncrementalAt: number | null
    lastFullScanAt: number | null
    lastResult: string | null
}

export type FullScanState =
    | { status: "idle" }
    | { status: "running"; message: string }
    | { status: "complete"; message: string }
    | { status: "failed"; message: string }

export const syncStatus = van.state<SyncStatus | null>(null)
export const syncConfiguration = van.state<"unknown" | "missing" | "ready">("unknown")
export const syncError = van.state("")
export const fullScan = van.state<FullScanState>({ status: "idle" })

let scheduling = false

export async function syncControl(
    action: string,
    data: Record<string, unknown> = {},
): Promise<void> {
    await syncCommand(action, data)
    if (action === "configure") syncConfiguration.val = "unknown"
    await refreshSyncStatus()
}

export async function startFullScan(): Promise<void> {
    if (fullScan.rawVal.status === "running") return
    const reader = readerForCurrentAccount()
    fullScan.val = { status: "running", message: "Starting full scan…" }
    syncError.val = ""

    try {
        const offset = await runFullScan(reader, (message) => {
            fullScan.val = { status: "running", message }
        })
        const suffix = offset === 0 ? "" : ` Rule34's reported count differs by ${offset}.`
        fullScan.val = { status: "complete", message: `Full scan completed.${suffix}` }
        await refreshSyncStatus()
        void schedule()
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        fullScan.val = { status: "failed", message }
    }
}

export async function refreshSyncStatus(): Promise<void> {
    const response = await syncCommand<SyncStatus | { configured: false }>("status")
    if (!response.configured) {
        syncStatus.val = null
        syncConfiguration.val = "missing"
        return
    }
    syncStatus.val = response
    syncConfiguration.val = "ready"
}

async function schedule(): Promise<void> {
    if (scheduling || !canSync() || syncConfiguration.rawVal === "missing") return
    const knownStatus = syncStatus.rawVal
    if (knownStatus !== null && !knownStatus.baselineReady && knownStatus.pending === 0) return

    scheduling = true
    try {
        await refreshSyncStatus()
        if (syncConfiguration.rawVal !== "ready") return
        syncError.val = ""
        const status = syncStatus.rawVal
        if (status === null) return
        const reader = readerForCurrentAccount()

        let changed = false
        if (status.baselineReady) {
            const claim = await syncCommand<{ run: boolean }>("claim-incremental")
            if (claim.run) {
                await withBrowserLock("arueshalae-reconciliation", () => runIncremental(reader))
                changed = true
            }
        }
        if (status.pending > 0) {
            await withBrowserLock("arueshalae-downloads", () => drainDownloads(reader))
            changed = true
        }
        if (changed) await refreshSyncStatus()
    } catch (error) {
        syncError.val = error instanceof Error ? error.message : String(error)
    } finally {
        scheduling = false
    }
}

function canSync(): boolean {
    return serverSettings.rawVal.enabled && auth.rawVal.status === "authenticated"
}

function readerForCurrentAccount(): Rule34Reader {
    const account = auth.rawVal
    if (account.status !== "authenticated") throw new Error("Sign in to synchronize favorites")
    return new Rule34Reader(account.userId)
}

async function withBrowserLock(name: string, run: () => Promise<void>): Promise<void> {
    if (navigator.locks === undefined) return run()
    await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock !== null) await run()
    })
}

setInterval(() => void schedule(), POLL_INTERVAL_MS)

van.derive(() => {
    serverSettings.val
    auth.val
    syncStatus.val = null
    syncConfiguration.val = "unknown"
    void schedule()
})

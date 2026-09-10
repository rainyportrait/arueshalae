import van from "vanjs-core"

import { type SyncStatus, getSyncStatus } from "../api/sync.ts"
import { drainDownloads } from "../sync/download.ts"
import { Rule34Reader } from "../sync/rule34.ts"
import { type SyncPhase, synchronize } from "../sync/synchronize.ts"
import { auth } from "./auth.ts"
import { details } from "./details.ts"
import { refreshLibrary } from "./library.ts"
import { serverSettings } from "./settings.ts"

export type { SyncPhase }

export type SyncRun =
    | { status: "idle" }
    | { status: "running"; phase: SyncPhase }
    | { status: "complete"; message: string }
    | { status: "failed"; message: string }

export const syncStatus = van.state<SyncStatus | null>(null)
export const syncRun = van.state<SyncRun>({ status: "idle" })

export async function startSync(): Promise<void> {
    if (syncRun.rawVal.status === "running") return
    const account = auth.rawVal
    if (account.status !== "authenticated") {
        syncRun.val = { status: "failed", message: "Sign in to synchronize favorites." }
        return
    }

    syncRun.val = { status: "running", phase: { phase: "starting" } }
    const reader = new Rule34Reader(account.userId)

    try {
        await withBrowserLock(async () => {
            const count = await synchronize(reader, (phase) => {
                syncRun.val = { status: "running", phase }
            })
            await drainDownloads(reader, (done, total) => {
                syncRun.val = { status: "running", phase: { phase: "downloading", done, total } }
            })
            syncRun.val = {
                status: "complete",
                message: `Synchronized ${count.toLocaleString()} favorites.`,
            }
        })
        await refreshSyncStatus()
        const page = details.rawVal
        if (page.status === "ready") await refreshLibrary([page.post.id])
    } catch (error) {
        syncRun.val = {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
        }
    }
}

export async function refreshSyncStatus(): Promise<void> {
    if (!serverSettings.rawVal.enabled) {
        syncStatus.val = null
        return
    }
    syncStatus.val = await getSyncStatus()
}

async function withBrowserLock(run: () => Promise<void>): Promise<void> {
    if (navigator.locks === undefined) return run()
    await navigator.locks.request("arueshalae-sync", run)
}

van.derive(() => {
    serverSettings.val
    auth.val
    syncStatus.val = null
    if (serverSettings.rawVal.enabled) void refreshSyncStatus().catch(() => {})
})

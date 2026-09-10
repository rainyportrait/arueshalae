import { fetchServerJson, jsonRequest } from "./server.ts"

export type SyncStatus = {
    favorites: number
    pending: number
    initialized: boolean
    countOffset: number
    lastSyncAt: number | null
}

export type SyncBaseline = {
    ids: number[]
    initialized: boolean
    countOffset: number
    revision: number
}

export type ReconcileRequest = {
    ids: number[]
    deleted: number[]
    reportedCount: number
    revision: number
}

export async function getSyncStatus(): Promise<SyncStatus> {
    return fetchServerJson("api/sync/status")
}

export async function getSyncBaseline(): Promise<SyncBaseline> {
    return fetchServerJson("api/sync/baseline")
}

export async function reconcileFavorites(data: ReconcileRequest): Promise<void> {
    await fetchServerJson("api/sync/reconcile", jsonRequest(data))
}

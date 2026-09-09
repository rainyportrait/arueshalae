import { syncCommand } from "../api/sync.ts"
import { reconcilePrefix, reconcileRemovals } from "./reconcile.ts"
import { FAVORITES_PAGE_SIZE, Rule34Reader } from "./rule34.ts"

type Baseline = { ids: number[]; initialized: boolean; countOffset: number; revision: number }

// The phases of an explicit sync. synchronize() reports the reading,
// verifying, and checking-removals phases; state/sync.ts wraps them with
// "starting" and "downloading".
export type SyncPhase =
    | { phase: "starting" }
    | { phase: "reading"; page: number; pages: number }
    | { phase: "verifying" }
    | { phase: "checking-removals"; done: number; total: number }
    | { phase: "downloading"; done: number; total: number }

type Progress = (phase: SyncPhase) => void

export async function synchronize(reader: Rule34Reader, progress: Progress): Promise<number> {
    const baseline = await syncCommand<Baseline>("baseline")
    const reportedCount = await reader.reportedCount()
    const first = await reader.favoritesPage(0)
    const pages = new Map<number, number[]>([[0, first.ids]])
    // lastPosition is the pid of the last page, a multiple of the page size,
    // so the total page count is known as soon as the first page is read.
    const totalPages = Math.floor(first.lastPosition / FAVORITES_PAGE_SIZE) + 1
    progress({ phase: "reading", page: 1, pages: totalPages })
    const readPage = async (position: number): Promise<number[]> => {
        const cached = pages.get(position)
        if (cached !== undefined) return cached
        progress({ phase: "reading", page: position / FAVORITES_PAGE_SIZE + 1, pages: totalPages })
        const ids = (await reader.favoritesPage(position)).ids
        pages.set(position, ids)
        return ids
    }

    const ids = baseline.initialized
        ? await readIncrementally(baseline, reportedCount, first.lastPosition, readPage)
        : await readAll(first.lastPosition, readPage)

    if (pages.size > 1) {
        progress({ phase: "verifying" })
        const verifyCount = await reader.reportedCount()
        const verifyFirst = (await reader.favoritesPage(0)).ids
        if (verifyCount !== reportedCount || !sameIds(first.ids, verifyFirst)) {
            throw new Error("Favorites changed during synchronization; run Sync again")
        }
    }

    const current = new Set(ids)
    const disappeared = baseline.ids.filter((postId) => !current.has(postId))
    const deleted: number[] = []
    for (const [index, postId] of disappeared.entries()) {
        progress({ phase: "checking-removals", done: index + 1, total: disappeared.length })
        if ((await reader.postDetails(postId)) === null) deleted.push(postId)
    }

    await syncCommand("reconcile", { ids, deleted, reportedCount, revision: baseline.revision })
    return ids.length
}

async function readIncrementally(
    baseline: Baseline,
    reportedCount: number,
    lastPosition: number,
    readPage: (position: number) => Promise<number[]>,
): Promise<number[]> {
    const count = reportedCount - baseline.countOffset
    if (count < 0) return readAll(lastPosition, readPage)

    const known = new Set(baseline.ids)
    const observed: number[] = []
    for (let position = 0; position <= lastPosition; position += FAVORITES_PAGE_SIZE) {
        observed.push(...(await readPage(position)))
        if (observed.some((postId) => known.has(postId))) break
    }
    if (!observed.some((postId) => known.has(postId))) return readAll(lastPosition, readPage)

    const candidate = reconcilePrefix(baseline.ids, observed)
    if (candidate.length === count) return candidate
    if (candidate.length < count) return readAll(lastPosition, readPage)

    const missingCount = candidate.length - count
    const pageCount = Math.max(1, Math.ceil(count / FAVORITES_PAGE_SIZE))
    const binaryCost = missingCount * Math.ceil(Math.log2(pageCount + 1))
    if (binaryCost >= pageCount) return readAll(lastPosition, readPage)

    try {
        return await reconcileRemovals(candidate, observed.length, count, readPage, async () => {})
    } catch (error) {
        if (!(error instanceof Error) || !isOrderingFailure(error.message)) throw error
        return readAll(lastPosition, readPage)
    }
}

async function readAll(
    lastPosition: number,
    readPage: (position: number) => Promise<number[]>,
): Promise<number[]> {
    const ids: number[] = []
    for (let position = 0; position <= lastPosition; position += FAVORITES_PAGE_SIZE) {
        ids.push(...(await readPage(position)))
    }
    if (new Set(ids).size !== ids.length) {
        throw new Error("Favorite order changed during synchronization")
    }
    return ids
}

function isOrderingFailure(message: string): boolean {
    return (
        message.includes("contradicts the baseline") ||
        message.includes("No progress") ||
        message.includes("Unresolved additions")
    )
}

function sameIds(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((postId, index) => postId === right[index])
}

import { SyncWorker } from "./worker.ts"

const FAVORITES_PAGE_SIZE = 50

type FullScanProgress = {
    position: number
    phase: "scan" | "verify" | "classify"
    count: number | null
}

export type FullScanState = FullScanProgress & ({ runId: number } | { runId: null })

export async function advanceFullScan(worker: SyncWorker, state: FullScanState): Promise<void> {
    if (state.runId === null) return

    const count = state.count ?? (await worker.favoriteCount())
    await checkResumeBoundary(worker, state, count)

    if (state.phase === "scan" || state.phase === "verify") {
        await recordPage(worker, state, count)
    } else {
        await classifyMissingPost(worker, state, count)
    }
}

async function checkResumeBoundary(
    worker: SyncWorker,
    state: FullScanState & { runId: number },
    count: number,
): Promise<void> {
    const resumeKey = `${state.runId}:${state.phase}`
    if (worker.hasCheckedResumeBoundary(resumeKey)) return

    if (state.count !== null && (await worker.favoriteCount()) !== count) {
        throw new Error("Favorites changed since checkpoint")
    }

    if (state.position > 0) {
        const position = Math.max(0, state.position - FAVORITES_PAGE_SIZE)
        const postIds = await worker.favoritePage(position, count)
        await worker.command("boundary", { runId: state.runId, position, ids: postIds })
    }

    worker.markResumeBoundaryChecked(resumeKey)
}

async function recordPage(
    worker: SyncWorker,
    state: FullScanState & { runId: number },
    count: number,
): Promise<void> {
    if (state.phase === "verify" && count !== state.count) {
        throw new Error("Favorites changed between scan passes; cancel and restart")
    }

    const postIds = await worker.favoritePage(state.position, count)
    await worker.command("page", {
        runId: state.runId,
        position: state.position,
        count,
        ids: postIds,
        value: state.position + postIds.length >= count ? "end" : "",
    })
}

async function classifyMissingPost(
    worker: SyncWorker,
    state: FullScanState & { runId: number },
    count: number,
): Promise<void> {
    const { ids, front } = await worker.command<{ ids: number[]; front: number[] }>("finish", {
        runId: state.runId,
    })
    const postId = ids[0]

    if (postId !== undefined) {
        const post = await worker.postDetails(postId)
        await worker.command("classified", {
            runId: state.runId,
            postId,
            value: post === null ? "deleted" : "available",
        })
        return
    }

    if (count !== state.count || (await worker.favoriteCount()) !== count) {
        throw new Error("Favorites changed during classification")
    }

    const currentFront = await worker.favoritePage(0, count)
    const frontChanged =
        currentFront.length !== front.length ||
        !currentFront.every((postId, index) => postId === front[index])
    if (frontChanged) throw new Error("Favorites changed during classification")

    await worker.command("finish", { runId: state.runId, value: "commit" })
}

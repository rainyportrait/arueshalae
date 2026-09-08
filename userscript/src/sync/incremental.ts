import { syncCommand } from "../api/sync.ts"
import { reconcilePrefix, reconcileRemovals } from "./reconcile.ts"
import { Rule34Reader } from "./rule34.ts"

type Baseline = {
    ids: number[]
    countOffset: number
    budget: number
    revision: number
    ready: boolean
}

export async function runIncremental(reader: Rule34Reader): Promise<void> {
    const baseline = await syncCommand<Baseline>("baseline")
    const requests = new RequestBudget(baseline.budget)
    const budgetedReader = reader.withRequestBudget(() => requests.spend())
    const observed = new Set<number>()
    let front: number[] = []

    const readCount = async () => {
        const corrected = (await budgetedReader.reportedCount()) - baseline.countOffset
        if (corrected < 0) throw new Error("Stored favorite-count offset is no longer valid")
        return corrected
    }
    const readPage = async (position: number) => {
        const ids = (await budgetedReader.favoritesPage(position)).ids
        ids.forEach((postId) => observed.add(postId))
        return ids
    }

    try {
        if (!baseline.ready) throw new Error("Run an initial full scan first")
        const count = await readCount()
        front = await readPage(0)

        while (front.length < count && !front.some((postId) => baseline.ids.includes(postId))) {
            front.push(...(await readPage(front.length)))
        }

        const removed: number[] = []
        const deleted: number[] = []
        const order = await reconcileRemovals(
            reconcilePrefix(baseline.ids, front),
            front.length,
            count,
            readPage,
            async (candidates) => {
                for (const postId of candidates) {
                    if ((await budgetedReader.postDetails(postId)) === null) deleted.push(postId)
                    else removed.push(postId)
                }
                if ((await readCount()) !== count)
                    throw new Error("Favorites changed during search")
            },
        )

        if (removed.length > 0 || deleted.length > 0) {
            const currentFront = await readPage(0)
            if (!sameIds(front, currentFront)) throw new Error("Favorites changed during search")
        }

        await syncCommand("incremental", {
            ids: order,
            observed: [...observed],
            removed,
            deleted,
            reportedCount: count + baseline.countOffset,
            revision: baseline.revision,
            value: "reconciled",
        })
    } catch (error) {
        await syncCommand("incremental", {
            observed: [...observed],
            revision: baseline.revision,
            value: error instanceof Error ? error.message : String(error),
        })
    }
}

function sameIds(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((postId, index) => postId === right[index])
}

class RequestBudget {
    constructor(private remaining: number) {}

    spend(): void {
        if (this.remaining-- <= 0) {
            throw new Error("Request budget exhausted; reconciliation remains unresolved")
        }
    }
}

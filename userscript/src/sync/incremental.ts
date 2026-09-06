import { reconcilePrefix, reconcileRemovals } from "./reconcile.ts"
import { SyncWorker } from "./worker.ts"

type ReconciliationBaseline = {
    ids: number[]
    baseline: number | null
    due: boolean
    budget: number
    revision: number
}

export async function runIncrementalReconciliation(worker: SyncWorker): Promise<void> {
    const baseline = await worker.command<ReconciliationBaseline>("baseline")
    if (!baseline.due) return

    const requests = new RequestBudget(baseline.budget)
    const observed = new Set<number>()
    let front: number[] = []

    const readCount = async (): Promise<number> => {
        requests.spend()
        return worker.favoriteCount()
    }
    const readPage = async (position: number, count: number): Promise<number[]> => {
        requests.spend()

        const postIds = await worker.favoritePage(position, count)
        for (const postId of postIds) observed.add(postId)
        return postIds
    }

    try {
        const count = await readCount()
        front = await readPage(0, count)

        if (baseline.baseline === null) {
            throw new Error("Initial full scan required to establish order")
        }

        // New and re-added favorites form a prefix. Read until an entry from
        // the previous order anchors that prefix.
        while (front.length < count && !front.some((postId) => baseline.ids.includes(postId))) {
            front.push(...(await readPage(front.length, count)))
        }

        const removed: number[] = []
        const reconciledOrder = await reconcileRemovals(
            reconcilePrefix(baseline.ids, front),
            front.length,
            count,
            (position) => readPage(position, count),
            async (candidates) => {
                for (const postId of candidates) {
                    requests.spend()

                    const post = await worker.postDetails(postId)
                    await worker.command("availability", {
                        postId,
                        value: post === null ? "deleted" : "available",
                    })
                    if (post !== null) removed.push(postId)
                }

                if ((await readCount()) !== count) {
                    throw new Error("Favorites changed during search")
                }
            },
        )

        // Deeper requests take time. Recheck the head before publishing any
        // removals so a concurrent favorite cannot make the result stale.
        if (removed.length > 0) {
            const currentFront = await readPage(0, count)
            if (!currentFront.every((postId, index) => postId === front[index])) {
                throw new Error("Favorites changed during search")
            }
        }

        await worker.command("incremental", {
            ids: reconciledOrder,
            observed: [...observed],
            removed,
            count,
            revision: baseline.revision,
            value: "reconciled",
        })
    } catch (error) {
        await worker.command("incremental", {
            ids: front,
            observed: [...observed],
            revision: baseline.revision,
            value: String(error),
        })
    }
}

class RequestBudget {
    constructor(private remaining: number) {}

    spend(): void {
        if (this.remaining-- <= 0) {
            throw new Error("Request budget exhausted; reconciliation unresolved")
        }
    }
}

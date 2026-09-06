const FAVORITES_PAGE_SIZE = 50

// New and re-added favorites form a prefix. Move that observed prefix in front
// of the previous order before searching for entries missing farther down.
export function reconcilePrefix(baseline: number[], front: number[]): number[] {
    const moved = new Set(front)
    return [...front, ...baseline.filter((postId) => !moved.has(postId))]
}

export function missingBefore(local: number[], position: number, remotePostId: number): number[] {
    const index = local.indexOf(remotePostId, position)
    if (index < position) throw new Error("Observed order contradicts the baseline")

    return local.slice(position, index)
}

// After the reconciled prefix, the remote order must be a subsequence of the
// baseline. Find the first page that diverges, remove its local-only entries,
// and repeat until the lengths agree. Availability checks happen outside this
// pure ordering logic so the caller can distinguish removals from deletions.
export async function reconcileRemovals(
    initial: number[],
    frontLength: number,
    count: number,
    readPage: (position: number) => Promise<number[]>,
    checkMissing: (postIds: number[]) => Promise<void>,
): Promise<number[]> {
    let local = [...initial]

    while (local.length > count) {
        let low = Math.ceil(frontLength / FAVORITES_PAGE_SIZE)
        let high = Math.ceil(count / FAVORITES_PAGE_SIZE) - 1
        let mismatch: number[] | null = null
        let position = count

        while (low <= high) {
            const middle = Math.floor((low + high) / 2)
            const offset = middle * FAVORITES_PAGE_SIZE
            const remote = await readPage(offset)

            if (remote.every((postId, index) => local[offset + index] === postId)) {
                low = middle + 1
            } else {
                mismatch = remote
                position = offset
                high = middle - 1
            }
        }

        const candidates: number[] = []
        if (mismatch !== null) {
            for (const [index, remotePostId] of mismatch.entries()) {
                if (local[position + index] === remotePostId) continue

                const gap = missingBefore(local, position + index, remotePostId)
                if (gap.length === 0) throw new Error("No progress resolving order")

                candidates.push(...gap)
                local.splice(position + index, gap.length)
            }
        } else {
            candidates.push(...local.slice(count))
            local = local.slice(0, count)
        }

        if (candidates.length === 0) throw new Error("No progress resolving discrepancy")
        await checkMissing(candidates)
    }

    if (local.length !== count) {
        throw new Error("Unresolved additions beyond the observed prefix")
    }
    return local
}

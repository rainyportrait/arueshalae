// After a reconciled prefix, remote order must be a subsequence of the baseline.
// This function is pure so the search assumptions can be tested independently.
export function reconcilePrefix(baseline: number[], front: number[]): number[] {
    const moved = new Set(front)
    return [...front, ...baseline.filter((id) => !moved.has(id))]
}

export function missingBefore(local: number[], position: number, remoteId: number): number[] {
    const index = local.indexOf(remoteId, position)
    if (index < position) throw new Error("Observed order contradicts the baseline")
    return local.slice(position, index)
}

export async function reconcileRemovals(
    initial: number[],
    frontLength: number,
    count: number,
    readPage: (position: number) => Promise<number[]>,
    checkMissing: (ids: number[]) => Promise<void>,
): Promise<number[]> {
    let local = [...initial]
    while (local.length > count) {
        let low = Math.ceil(frontLength / 50),
            high = Math.ceil(count / 50) - 1
        let mismatch: number[] | null = null,
            position = count
        while (low <= high) {
            const mid = Math.floor((low + high) / 2),
                offset = mid * 50
            const ids = await readPage(offset)
            if (ids.every((id, i) => local[offset + i] === id)) low = mid + 1
            else {
                mismatch = ids
                position = offset
                high = mid - 1
            }
        }
        const candidates: number[] = []
        if (mismatch) {
            for (let i = 0; i < mismatch.length; i++) {
                const id = mismatch[i]!
                if (local[position + i] !== id) {
                    const gap = missingBefore(local, position + i, id)
                    if (gap.length === 0) throw new Error("No progress resolving order")
                    candidates.push(...gap)
                    local.splice(position + i, gap.length)
                }
            }
        } else {
            candidates.push(...local.slice(count))
            local = local.slice(0, count)
        }
        if (candidates.length === 0) throw new Error("No progress resolving discrepancy")
        await checkMissing(candidates)
    }
    if (local.length !== count) throw new Error("Unresolved additions beyond the observed prefix")
    return local
}

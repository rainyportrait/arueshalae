import { syncCommand } from "../api/sync.ts"
import { FAVORITES_PAGE_SIZE, Rule34Reader } from "./rule34.ts"

type Baseline = { ids: number[]; knownIds: number[]; revision: number }
type Progress = (message: string) => void

// A full scan belongs to the tab where the user started it. If that tab
// closes, the next scan starts cleanly; there is no server-side run to revive.
export async function runFullScan(reader: Rule34Reader, progress: Progress): Promise<number> {
    const baseline = await syncCommand<Baseline>("baseline")
    const reportedCount = await reader.reportedCount()
    const first = await reader.favoritesPage(0)
    const ids = [...first.ids]

    for (
        let position = FAVORITES_PAGE_SIZE;
        position <= first.lastPosition;
        position += FAVORITES_PAGE_SIZE
    ) {
        progress(`Reading favorites ${position + 1}–${position + FAVORITES_PAGE_SIZE}`)
        ids.push(...(await reader.favoritesPage(position)).ids)
    }
    if (new Set(ids).size !== ids.length) throw new Error("Favorite order changed during the scan")

    const current = new Set(ids)
    const missing = baseline.knownIds.filter((postId) => !current.has(postId))
    const deleted: number[] = []
    for (const [index, postId] of missing.entries()) {
        progress(`Checking removed favorite ${index + 1} of ${missing.length}`)
        if ((await reader.postDetails(postId)) === null) deleted.push(postId)
    }

    progress("Verifying the scan")
    const verifyCount = await reader.reportedCount()
    const verifyFront = (await reader.favoritesPage(0)).ids
    if (verifyCount !== reportedCount || !sameIds(first.ids, verifyFront)) {
        throw new Error("Favorites changed during the scan; run it again")
    }

    const result = await syncCommand<{ countOffset: number }>("full-scan", {
        ids,
        deleted,
        reportedCount,
        revision: baseline.revision,
    })
    return result.countOffset
}

function sameIds(left: number[], right: number[]): boolean {
    return left.length === right.length && left.every((postId, index) => postId === right[index])
}

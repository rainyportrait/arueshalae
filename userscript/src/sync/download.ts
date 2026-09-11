import van from "vanjs-core"

import { getPendingPostIds } from "../api/library.ts"
import type { PostDetails } from "../api/post-details.ts"
import { details } from "../state/details.ts"
import { libraryPosts, refreshLibrary } from "../state/library.ts"
import { ensureFavoriteMedia, storeFavoriteMedia } from "./favorite-media.ts"
import { Rule34Reader } from "./rule34.ts"

export async function drainDownloads(
    reader: Rule34Reader,
    progress: (done: number, total: number) => void,
): Promise<void> {
    const ids = await getPendingPostIds()
    for (let index = 0; index < ids.length; index++) {
        // Report before downloading so the bar moves the moment work starts.
        progress(index + 1, ids.length)
        try {
            const result = await ensureFavoriteMedia(reader, ids[index])
            if (result === "downloaded") await refreshLibrary([ids[index]])
        } catch {
            // Missing media remains eligible for the next explicit Sync.
        }
    }
}

// In-flight downloads per post. The favorite action and the automatic
// retry below can race for the same post (a status refresh settling while
// the button's upload is still running), and a duplicate would fetch and
// upload the same media twice.
const inFlightDownloads = new Map<number, Promise<void>>()

export function downloadKnownPost(post: PostDetails): Promise<void> {
    const existing = inFlightDownloads.get(post.id)
    if (existing !== undefined) return existing

    const task = (async () => {
        await storeFavoriteMedia(post)
        await refreshLibrary([post.id])
    })().finally(() => inFlightDownloads.delete(post.id))

    inFlightDownloads.set(post.id, task)
    return task
}

// A favorite whose media never landed (an upload failed from the favorite
// action or a Sync drain) self-heals on view: the details page holds both
// the post and the rule34 media URL, so no further user action is needed.
// One attempt per settled page — a failure publishes no state, so the
// derive cannot re-fire until a fresh payload or observation arrives.
van.derive(() => {
    const page = details.val
    if (page.status !== "ready") return
    const entry = libraryPosts.val.get(page.post.id)
    if (entry?.status !== "favorited" || entry.downloaded) return
    void downloadKnownPost(page.post).catch(() => {})
})

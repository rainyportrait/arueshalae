import van from "vanjs-core"

import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import { getPendingPostIds, setPostStatus } from "../api/library.ts"
import type { PostDetails } from "../api/post-details.ts"
import { savePostToServer } from "../api/server.ts"
import { details } from "../state/details.ts"
import { libraryPosts, refreshLibrary } from "../state/library.ts"
import { Rule34Reader } from "./rule34.ts"

const MEDIA_TIMEOUT_MS = 5 * 60 * 1000

export async function drainDownloads(
    reader: Rule34Reader,
    progress: (done: number, total: number) => void,
): Promise<void> {
    const ids = await getPendingPostIds()
    for (let index = 0; index < ids.length; index++) {
        // Report before downloading so the bar moves the moment work starts.
        progress(index + 1, ids.length)
        try {
            await downloadPost(reader, ids[index])
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
        await setPostStatus(post.id, "favorited")
        await savePostToServer(post, gmFetchArrayBuffer, MEDIA_TIMEOUT_MS)
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

async function downloadPost(reader: Rule34Reader, postId: number): Promise<void> {
    const post = await reader.postDetails(postId)
    if (post === null) {
        await setPostStatus(postId, "deleted")
        return
    }

    await downloadKnownPost(post)
}

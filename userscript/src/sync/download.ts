import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import type { PostDetails } from "../api/post-details.ts"
import { savePostToServer } from "../api/server.ts"
import { syncCommand } from "../api/sync.ts"
import { refreshLibrary } from "../state/library.ts"
import { Rule34Reader } from "./rule34.ts"

const MEDIA_TIMEOUT_MS = 5 * 60 * 1000

export async function drainDownloads(
    reader: Rule34Reader,
    progress: (done: number, total: number) => void,
): Promise<void> {
    const { ids } = await syncCommand<{ ids: number[] }>("downloads")
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

export async function downloadKnownPost(post: PostDetails): Promise<void> {
    await syncCommand("availability", { postId: post.id, value: "available" })
    await savePostToServer(post, gmFetchArrayBuffer, MEDIA_TIMEOUT_MS)
    await refreshLibrary([post.id])
}

async function downloadPost(reader: Rule34Reader, postId: number): Promise<void> {
    const post = await reader.postDetails(postId)
    if (post === null) {
        await syncCommand("availability", { postId, value: "deleted" })
        return
    }

    await downloadKnownPost(post)
}

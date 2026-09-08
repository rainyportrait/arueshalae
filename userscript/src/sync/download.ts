import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import { savePostToServer } from "../api/server.ts"
import { syncCommand } from "../api/sync.ts"
import { refreshLibrary } from "../state/library.ts"
import { Rule34Reader } from "./rule34.ts"

const MEDIA_TIMEOUT_MS = 5 * 60 * 1000

export async function drainDownloads(reader: Rule34Reader): Promise<void> {
    for (;;) {
        const { postId } = await syncCommand<{ postId: number | null }>("next-download")
        if (postId === null) return

        try {
            await downloadPost(reader, postId)
        } catch (error) {
            await syncCommand("download-failed", {
                postId,
                value: error instanceof Error ? error.message : String(error),
            })
        }
    }
}

async function downloadPost(reader: Rule34Reader, postId: number): Promise<void> {
    const post = await reader.postDetails(postId)
    if (post === null) {
        await syncCommand("availability", { postId, value: "deleted" })
        return
    }

    await syncCommand("availability", { postId, value: "available" })
    await savePostToServer(post, gmFetchArrayBuffer, MEDIA_TIMEOUT_MS)
    await refreshLibrary([postId])
}

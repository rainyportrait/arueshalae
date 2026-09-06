import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import { savePostToServer } from "../api/server.ts"
import { refreshLibrary } from "../state/library.ts"
import { SyncWorker } from "./worker.ts"

const MEDIA_TIMEOUT_MS = 5 * 60 * 1000

export async function runDownloads(worker: SyncWorker): Promise<void> {
    for (;;) {
        const { postId } = await worker.command<{ postId: number | null }>("next")
        if (postId === null) return

        try {
            await downloadPost(worker, postId)
        } catch (error) {
            await worker.command("failed", { postId, value: String(error) })
        }
    }
}

async function downloadPost(worker: SyncWorker, postId: number): Promise<void> {
    const post = await worker.postDetails(postId)
    if (post === null) {
        await worker.command("availability", { postId, value: "deleted" })
        return
    }

    await worker.command("availability", { postId, value: "available" })
    await worker.pace()
    await savePostToServer(
        post,
        async (url, timeout) => {
            const bytes = await gmFetchArrayBuffer(url, timeout)
            worker.recordProgress()

            if (!worker.isCurrent()) throw new Error("Worker stopped")
            return bytes
        },
        MEDIA_TIMEOUT_MS,
    )

    worker.recordProgress()
    await refreshLibrary([postId])
}

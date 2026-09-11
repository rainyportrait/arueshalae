import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import { observePost, setPostStatus } from "../api/library.ts"
import type { PostDetails } from "../api/post-details.ts"
import { savePostToServer } from "../api/server.ts"
import { Rule34Reader } from "./rule34.ts"

const MEDIA_TIMEOUT_MS = 5 * 60 * 1000

export async function storeFavoriteMedia(post: PostDetails): Promise<void> {
    await setPostStatus(post.id, "favorited")
    await observePost(post)
    await savePostToServer(post, gmFetchArrayBuffer, MEDIA_TIMEOUT_MS)
}

export async function ensureFavoriteMedia(
    reader: Rule34Reader,
    postId: number,
): Promise<"downloaded" | "deleted"> {
    const post = await reader.postDetails(postId)
    if (post === null) {
        await setPostStatus(postId, "deleted")
        return "deleted"
    }

    await storeFavoriteMedia(post)
    return "downloaded"
}

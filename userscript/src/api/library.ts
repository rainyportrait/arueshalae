import type { PostDetails } from "./post-details.ts"
import { fetchServerJson, jsonRequest, serverTags } from "./server.ts"

export type LibraryPost = {
    postId: number
    membership: "favorited" | "unfavorited"
    availability: "available" | "deleted" | "unknown"
    downloaded: boolean
}

export async function getPostStatuses(postIds: number[]): Promise<LibraryPost[]> {
    const query = new URLSearchParams({ ids: postIds.join(",") })
    const response = await fetchServerJson<{ posts: LibraryPost[] }>(`api/posts/status?${query}`)
    return response.posts
}

export async function getPendingPostIds(): Promise<number[]> {
    const response = await fetchServerJson<{ postIds: number[] }>("api/posts/pending")
    return response.postIds
}

export async function setFavoriteMembership(postId: number, favorited: boolean): Promise<void> {
    await fetchServerJson(
        `api/posts/${postId}/membership`,
        jsonRequest({ membership: favorited ? "favorited" : "unfavorited" }),
    )
}

// The server applies observations only to current favorites, so an ordinary
// post visit cannot create library membership.
export async function observePost(post: PostDetails): Promise<void> {
    await fetchServerJson(
        `api/posts/${post.id}/observation`,
        jsonRequest({ tags: serverTags(post.tags) }),
    )
}

export async function setPostAvailability(
    postId: number,
    availability: "available" | "deleted",
): Promise<void> {
    await fetchServerJson(`api/posts/${postId}/availability`, jsonRequest({ availability }))
}

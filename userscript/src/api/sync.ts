import type { PostDetails } from "./post-details.ts"
import { ServerError, fetchServerResponse, serverTags } from "./server.ts"

export async function syncCommand<T>(
    action: string,
    data: Record<string, unknown> = {},
): Promise<T> {
    const response = await fetchServerResponse("api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
    })
    if (!response.ok) {
        const message = await responseMessage(response)
        throw new ServerError(message || `The server responded with ${response.status}`)
    }

    return response.json() as Promise<T>
}

export async function setFavoriteMembership(postId: number, favorited: boolean): Promise<void> {
    await syncCommand("membership", {
        postId,
        value: favorited ? "favorited" : "unfavorited",
    })
}

// Report the current metadata from a live Rule34 post page. The server applies
// it only when the post is already known as a favorite, so this never creates
// membership from an ordinary post visit.
export async function observePost(post: PostDetails): Promise<void> {
    await syncCommand("observation", { postId: post.id, tags: serverTags(post.tags) })
}

async function responseMessage(response: Response): Promise<string> {
    try {
        return await response.text()
    } catch {
        return ""
    }
}

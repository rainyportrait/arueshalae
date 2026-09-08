import { ServerError, fetchServerResponse } from "./server.ts"

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

async function responseMessage(response: Response): Promise<string> {
    try {
        return await response.text()
    } catch {
        return ""
    }
}

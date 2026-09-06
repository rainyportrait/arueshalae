import { auth } from "../state/auth.ts"
import { ServerError, fetchServerResponse } from "./server.ts"

export async function syncCommand<T>(
    action: string,
    data: Record<string, unknown> = {},
): Promise<T> {
    const account = auth.rawVal
    if (account.status !== "authenticated") throw new Error("Sign in to configure synchronization")
    const response = await fetchServerResponse("api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.userId, action, ...data }),
    })
    if (!response.ok) {
        let message = ""
        try {
            message = await response.text()
        } catch {}
        throw new ServerError(message || `The server responded with ${response.status}`)
    }
    return response.json() as Promise<T>
}

export async function setFavoriteMembership(postId: number, favorited: boolean): Promise<void> {
    await syncCommand("membership", { postId, value: favorited ? "favorited" : "unfavorited" })
}

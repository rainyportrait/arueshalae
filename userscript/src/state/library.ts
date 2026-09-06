import van from "vanjs-core"

import { syncCommand } from "../api/sync.ts"
import { auth } from "./auth.ts"
import { details } from "./details.ts"
import { markDownloaded } from "./downloaded.ts"
import { serverSettings } from "./settings.ts"

export type LibraryPost = {
    postId: number
    membership: string
    availability: string
    downloaded: boolean
    error: string | null
    downloadState?: string
}
export const libraryPosts = van.state<Map<number, LibraryPost>>(new Map())
export async function refreshLibrary(ids: number[]): Promise<void> {
    if (!serverSettings.rawVal.enabled || auth.rawVal.status !== "authenticated") return
    const account = auth.rawVal
    const url = serverSettings.rawVal.url
    const { posts } = await syncCommand<{ posts: LibraryPost[] }>("memberships", { ids })
    if (
        auth.rawVal !== account ||
        serverSettings.rawVal.url !== url ||
        !serverSettings.rawVal.enabled
    )
        return
    const next = new Map(libraryPosts.rawVal)
    for (const post of posts) {
        next.set(post.postId, post)
        if (post.downloaded) markDownloaded([post.postId])
    }
    libraryPosts.val = next
}
van.derive(() => {
    const d = details.val
    if (serverSettings.val.enabled && auth.val.status === "authenticated" && d.status === "ready")
        void refreshLibrary([d.post.id]).catch(() => {})
})
setInterval(() => {
    const d = details.rawVal
    if (d.status === "ready") void refreshLibrary([d.post.id]).catch(() => {})
}, 15000)

van.derive(() => {
    auth.val
    serverSettings.val
    libraryPosts.val = new Map()
})

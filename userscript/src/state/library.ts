import van from "vanjs-core"

import { syncCommand } from "../api/sync.ts"
import { auth } from "./auth.ts"
import { details } from "./details.ts"
import { markDownloaded } from "./downloaded.ts"
import { serverSettings } from "./settings.ts"

const LIBRARY_POLL_INTERVAL_MS = 15_000

export type LibraryPost = {
    postId: number
    membership: string
    availability: string
    downloaded: boolean
    error: string | null
    downloadState?: string
}

export const libraryPosts = van.state<Map<number, LibraryPost>>(new Map())

export async function refreshLibrary(postIds: number[]): Promise<void> {
    const account = auth.rawVal
    const settings = serverSettings.rawVal
    if (!settings.enabled || account.status !== "authenticated") return

    const { posts } = await syncCommand<{ posts: LibraryPost[] }>("memberships", {
        ids: postIds,
    })

    // Do not publish a response requested for an account or server which is
    // no longer current.
    if (
        auth.rawVal !== account ||
        serverSettings.rawVal.url !== settings.url ||
        !serverSettings.rawVal.enabled
    ) {
        return
    }

    const next = new Map(libraryPosts.rawVal)
    for (const post of posts) {
        next.set(post.postId, post)
        if (post.downloaded) markDownloaded([post.postId])
    }
    libraryPosts.val = next
}

// Load membership with the details page and poll while it remains open. This
// lets background reconciliation change the button without rebuilding the page.
van.derive(() => {
    const page = details.val
    if (
        serverSettings.val.enabled &&
        auth.val.status === "authenticated" &&
        page.status === "ready"
    ) {
        void refreshLibrary([page.post.id]).catch(() => {})
    }
})

setInterval(() => {
    const page = details.rawVal
    if (page.status === "ready") void refreshLibrary([page.post.id]).catch(() => {})
}, LIBRARY_POLL_INTERVAL_MS)

// Membership belongs to the selected account and server, so no cached entry
// survives a context change.
van.derive(() => {
    auth.val
    serverSettings.val
    libraryPosts.val = new Map()
})

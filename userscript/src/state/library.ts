import van from "vanjs-core"

import { type LibraryPost, getPostStatuses } from "../api/library.ts"
import { auth } from "./auth.ts"
import { details } from "./details.ts"
import { markDownloaded } from "./downloaded.ts"
import { serverSettings } from "./settings.ts"

export const libraryPosts = van.state<Map<number, LibraryPost>>(new Map())

let nextRequestSequence = 0
const latestRequestByPost = new Map<number, number>()

export async function refreshLibrary(postIds: number[]): Promise<void> {
    const account = auth.rawVal
    const settings = serverSettings.rawVal
    if (!settings.enabled || account.status !== "authenticated") return

    const requests = new Map<number, number>()
    for (const postId of postIds) {
        const sequence = ++nextRequestSequence
        latestRequestByPost.set(postId, sequence)
        requests.set(postId, sequence)
    }

    const posts = await getPostStatuses(postIds)

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
    let changed = false
    for (const post of posts) {
        if (latestRequestByPost.get(post.postId) !== requests.get(post.postId)) continue
        next.set(post.postId, post)
        changed = true
        if (post.downloaded) markDownloaded([post.postId])
    }
    if (changed) libraryPosts.val = next
}

// Load membership with the details page. Post observations happen at the
// shared post-details cache boundary, which also covers gallery prefetches.
// Explicit favorite and sync actions refresh the affected state themselves.
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

// Membership belongs to the selected account and server, so no cached entry
// survives a context change. The first evaluation is module initialization,
// not a context change — skipping it keeps the initial status refresh (the
// trigger derive fires it during module load on a direct details-page load,
// before this derive's first evaluation has run) from being invalidated
// before its response settles. The states must be read before the early
// return, or the derive would never subscribe to them.
let resetFirstEvaluation = true
van.derive(() => {
    auth.val
    serverSettings.val
    if (resetFirstEvaluation) {
        resetFirstEvaluation = false
        return
    }
    latestRequestByPost.clear()
    libraryPosts.val = new Map()
})

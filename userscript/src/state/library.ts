import van from "vanjs-core"

import { type LibraryPost, getPostStatuses } from "../api/library.ts"
import { checkDownloads } from "../api/server.ts"
import { details } from "./details.ts"
import { favorites } from "./favorites.ts"
import { loadedPosts } from "./gallery-collection.ts"
import { gallery } from "./gallery.ts"
import { list } from "./list.ts"
import { serverSettings } from "./settings.ts"

export type LocalLibraryPost = {
    postId: number
    status: LibraryPost["status"] | null
    downloaded: boolean
}

// One session-local record per post, populated from /api/posts/status. A null
// status means the server answered that it has no database row for the post.
// Lifecycle and media availability deliberately live together so mutations
// cannot update one client cache while leaving another stale.
export const libraryPosts = van.state<Map<number, LocalLibraryPost>>(new Map())

const checking = new Set<number>()
const queued = new Set<number>()
let checkQueued = false
let nextRequestSequence = 0
const latestRequestByPost = new Map<number, number>()

let serverContext = normalizedServerUrl()
let serverGeneration = 0

function normalizedServerUrl(): string {
    return normalizedUrl(serverSettings.rawVal.url)
}

export function queueLibraryCheck(postId: number): void {
    if (!serverSettings.val.enabled || libraryPosts.rawVal.has(postId) || checking.has(postId))
        return

    queued.add(postId)
    if (checkQueued) return
    checkQueued = true
    queueMicrotask(() => {
        checkQueued = false
        const postIds = [...queued]
        queued.clear()
        if (serverSettings.rawVal.enabled) checkLibraryPosts(postIds)
    })
}

// Query only records that this server context has not answered. Failed checks
// remain absent and are therefore retried when a collection settles again.
export function checkLibraryPosts(
    postIds: number[],
    check: (ids: number[]) => Promise<Set<number>> = checkDownloads,
): void {
    const unknown = postIds.filter((id) => !libraryPosts.rawVal.has(id) && !checking.has(id))
    if (unknown.length === 0) return

    const generation = serverGeneration
    for (const postId of unknown) checking.add(postId)
    void check(unknown).then(
        (downloaded) => {
            if (generation !== serverGeneration) return
            for (const postId of unknown) checking.delete(postId)
            publishDownloadResponse(unknown, downloaded)
        },
        () => {
            if (generation !== serverGeneration) return
            for (const postId of unknown) checking.delete(postId)
        },
    )
}

// Force-refresh records after a membership, observation, download, or Sync
// mutation. Per-post sequence numbers keep an older response from overwriting
// a newer one.
export async function refreshLibrary(postIds: number[]): Promise<void> {
    const settings = serverSettings.rawVal
    if (!settings.enabled || postIds.length === 0) return

    const requests = new Map<number, number>()
    for (const postId of postIds) {
        const sequence = ++nextRequestSequence
        latestRequestByPost.set(postId, sequence)
        requests.set(postId, sequence)
    }

    const posts = await getPostStatuses(postIds)
    if (!serverSettings.rawVal.enabled || normalizedServerUrl() !== normalizedUrl(settings.url))
        return

    const returned = new Map(posts.map((post) => [post.postId, post]))
    const next = new Map(libraryPosts.rawVal)
    let changed = false
    for (const postId of postIds) {
        if (latestRequestByPost.get(postId) !== requests.get(postId)) continue
        next.set(postId, returned.get(postId) ?? missingPost(postId, next.get(postId)))
        changed = true
    }
    if (changed) libraryPosts.val = next
}

export function forgetLibraryPosts(postIds: Iterable<number>): void {
    const next = new Map(libraryPosts.rawVal)
    let changed = false
    for (const postId of postIds) {
        latestRequestByPost.delete(postId)
        changed = next.delete(postId) || changed
    }
    if (changed) libraryPosts.val = next
}

function publishDownloadResponse(requested: number[], downloaded: Set<number>): void {
    const next = new Map(libraryPosts.rawVal)
    let changed = false
    for (const postId of requested) {
        const current = next.get(postId)
        const post: LocalLibraryPost = {
            postId,
            status: current?.status ?? null,
            downloaded: downloaded.has(postId),
        }
        if (!samePost(next.get(postId), post)) {
            next.set(postId, post)
            changed = true
        }
    }
    if (changed) libraryPosts.val = next
}

function missingPost(postId: number, current?: LocalLibraryPost): LocalLibraryPost {
    return { postId, status: null, downloaded: current?.downloaded ?? false }
}

function samePost(left: LocalLibraryPost | undefined, right: LocalLibraryPost): boolean {
    return left?.status === right.status && left.downloaded === right.downloaded
}

function normalizedUrl(url: string): string {
    return url.trim().replace(/\/+$/, "")
}

van.derive(() => {
    const settings = serverSettings.val
    const context = normalizedUrl(settings.url)
    if (context === serverContext) return

    serverContext = context
    serverGeneration += 1
    checking.clear()
    queued.clear()
    latestRequestByPost.clear()
    libraryPosts.val = new Map()
})

van.derive(() => {
    if (!serverSettings.val.enabled) return
    const loadedList = list.val
    if (loadedList.status === "ready") checkLibraryPosts(loadedList.posts.map((post) => post.id))
    const loadedFavorites = favorites.val
    if (loadedFavorites.status === "ready")
        checkLibraryPosts(loadedFavorites.posts.map((post) => post.id))
    const loadedGallery = gallery.val
    if (loadedGallery.status === "ready")
        checkLibraryPosts(loadedPosts(loadedGallery).map(({ post }) => post.id))
})

van.derive(() => {
    if (!serverSettings.val.enabled) return
    const page = details.val
    if (page.status === "ready") {
        checkLibraryPosts([page.post.id])
        void refreshLibrary([page.post.id]).catch(() => {})
    }
})

import type { State } from "vanjs-core"

import {
    type LocalLibraryPost,
    checkLibraryPosts,
    forgetLibraryPosts,
    libraryPosts,
} from "./library.ts"

// Compatibility view for callers and tests that only care about media. The
// map in state/library.ts remains the sole stored per-post truth.
let downloadedSource = libraryPosts.rawVal
let downloadedSnapshot = downloadedIds(downloadedSource)

function currentDownloaded(posts: Map<number, LocalLibraryPost>): Set<number> {
    if (posts !== downloadedSource) {
        downloadedSource = posts
        const next = downloadedIds(posts)
        if (!sameIds(downloadedSnapshot, next)) downloadedSnapshot = next
    }
    return downloadedSnapshot
}

function sameIds(left: Set<number>, right: Set<number>): boolean {
    return left.size === right.size && [...left].every((postId) => right.has(postId))
}

export const downloaded: State<Set<number>> = {
    get val() {
        return currentDownloaded(libraryPosts.val)
    },
    set val(ids) {
        const next = new Map(libraryPosts.rawVal)
        for (const [postId, post] of next)
            next.set(postId, { ...post, downloaded: ids.has(postId) })
        for (const postId of ids)
            if (!next.has(postId)) next.set(postId, { postId, status: null, downloaded: true })
        libraryPosts.val = next
    },
    get oldVal() {
        return downloadedIds(libraryPosts.oldVal)
    },
    get rawVal() {
        return currentDownloaded(libraryPosts.rawVal)
    },
}

export const checkDownloadsPage = checkLibraryPosts

export function markDownloaded(postIds: Iterable<number>): void {
    const next = new Map(libraryPosts.rawVal)
    let changed = false
    for (const postId of postIds) {
        const current = next.get(postId)
        if (current?.downloaded) continue
        next.set(postId, { postId, status: current?.status ?? null, downloaded: true })
        changed = true
    }
    if (changed) libraryPosts.val = next
}

export function unmarkDownloaded(postId: number): void {
    const current = libraryPosts.rawVal.get(postId)
    if (current === undefined || !current.downloaded) return
    const next = new Map(libraryPosts.rawVal)
    next.set(postId, { ...current, downloaded: false })
    libraryPosts.val = next
}

function downloadedIds(posts: Map<number, LocalLibraryPost>): Set<number> {
    return new Set([...posts.values()].filter((post) => post.downloaded).map((post) => post.postId))
}

export { forgetLibraryPosts }

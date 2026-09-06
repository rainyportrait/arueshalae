import van, { type State } from "vanjs-core"

import { sessionAlive } from "../api/auth.ts"
import {
    type AddFavoriteResult,
    type RemoveFavoriteResult,
    addFavorite,
    removeFavorite,
} from "../api/favorites.ts"
import type { PostDetails } from "../api/post-details.ts"
import { unfavoriteOnServer } from "../api/server.ts"
import { setFavoriteMembership } from "../api/sync.ts"
import { auth } from "./auth.ts"
import { refreshLibrary } from "./library.ts"
import { serverSettings } from "./settings.ts"

// "saving" covers the short membership write. Media is handled independently by
// the persistent download queue; success here does not imply a downloaded copy.
export type FavoriteStatus =
    | "idle"
    | "adding"
    | "saving"
    | "added"
    | "already"
    | "library-failed"
    | "removing"
    | "removal-failed"
    | "stale-session"
export type SaveToLibrary = (post: PostDetails) => Promise<void>
export type SessionCheck = (userId: number) => Promise<boolean>
export type UnfavoriteInLibrary = (postId: number) => Promise<void>
const productionSave: SaveToLibrary = (post) => setFavoriteMembership(post.id, true)
const productionSessionCheck: SessionCheck = (userId) =>
    userId > 0 ? sessionAlive(userId) : Promise.resolve(false)
export const librarySaves = van.state<Map<number, Promise<boolean>>>(new Map())

let membershipWrites: Promise<void> = Promise.resolve()

async function startLibrarySave(post: PostDetails, save: SaveToLibrary): Promise<boolean> {
    const existing = librarySaves.rawVal.get(post.id)
    if (existing) return existing
    const task = membershipWrites
        .then(() => save(post))
        .then(
            () => {
                void refreshLibrary([post.id]).catch(() => {})
                return true
            },
            () => false,
        )
        .finally(() => {
            const next = new Map(librarySaves.rawVal)
            next.delete(post.id)
            librarySaves.val = next
        })
    membershipWrites = task.then(() => {})
    librarySaves.val = new Map(librarySaves.rawVal).set(post.id, task)
    return task
}

export async function addFavoriteWithStatus(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    add: typeof addFavorite = addFavorite,
    save: SaveToLibrary = productionSave,
): Promise<void> {
    favorite.val = "adding"
    let result: AddFavoriteResult
    try {
        result = await add(post.id)
    } catch {
        if (isCurrent()) favorite.val = "idle"
        return
    }
    if (!isCurrent()) return
    if (!result.ok && result.reason === "not-logged-in") {
        favorite.val = "idle"
        return
    }
    const end = result.ok ? "added" : "already"
    if (!serverSettings.rawVal.enabled) {
        favorite.val = end
        return
    }
    favorite.val = "saving"
    const saved = await startLibrarySave(post, save)
    if (isCurrent()) favorite.val = saved ? end : "library-failed"
}

export async function retryLibrarySave(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    save: SaveToLibrary = productionSave,
): Promise<void> {
    if (!serverSettings.rawVal.enabled) {
        favorite.val = "already"
        return
    }
    favorite.val = "saving"
    const saved = await startLibrarySave(post, save)
    if (isCurrent()) favorite.val = saved ? "already" : "library-failed"
}

export async function removeFavoriteWithStatus(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    remove: (id: number) => Promise<RemoveFavoriteResult> = removeFavorite,
    sessionCheck: SessionCheck = productionSessionCheck,
    del: UnfavoriteInLibrary = unfavoriteOnServer,
): Promise<void> {
    const previous = favorite.val
    favorite.val = "removing"
    let result: RemoveFavoriteResult
    try {
        result = await remove(post.id)
    } catch {
        if (isCurrent()) favorite.val = previous
        return
    }
    if (!isCurrent()) return
    if (!result.ok) {
        const a = auth.rawVal
        let alive: boolean
        try {
            alive = await sessionCheck(a.status === "authenticated" ? a.userId : 0)
        } catch {
            if (isCurrent()) favorite.val = previous
            return
        }
        if (!isCurrent()) return
        if (!alive) {
            favorite.val = "stale-session"
            return
        }
    }
    await retryLibraryRemoval(post, favorite, isCurrent, del)
}

export async function retryLibraryRemoval(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    del: UnfavoriteInLibrary = unfavoriteOnServer,
): Promise<void> {
    if (!serverSettings.rawVal.enabled) {
        if (isCurrent()) favorite.val = "idle"
        return
    }
    favorite.val = "removing"
    try {
        await del(post.id)
    } catch {
        if (isCurrent()) favorite.val = "removal-failed"
        return
    }
    await refreshLibrary([post.id]).catch(() => {})
    if (isCurrent()) favorite.val = "idle"
}

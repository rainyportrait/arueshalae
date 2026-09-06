import van, { type State } from "vanjs-core"

import { sessionAlive } from "../api/auth.ts"
import {
    type AddFavoriteResult,
    type RemoveFavoriteResult,
    addFavorite,
    removeFavorite,
} from "../api/favorites.ts"
import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import type { PostDetails } from "../api/post-details.ts"
import { deletePostFromServer, savePostToServer } from "../api/server.ts"
import { auth } from "./auth.ts"
import { downloaded, markDownloaded, unmarkDownloaded } from "./downloaded.ts"
import { serverSettings } from "./settings.ts"

// The favorite button's lifecycle for the currently shown post. The button
// is a toggle over the same invariant: rule34 is asked first, and the
// library mirror runs only after rule34 acks — adding saves the mirror's
// copy (idle -> adding -> saving -> added/already), removing deletes it
// (removing -> idle). "library-failed" means rule34 holds the favorite but
// the server save failed; "removal-failed" is its mirror — rule34 already
// dropped the favorite but the server delete failed — and both retry just
// the server part. "stale-session" is a per-mount terminal reached when a
// removal 403ed with a dead session: neither rule34 nor the server was
// touched, and the post is still a favorite.
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

// The download + upload of the post's media to the server, injected so the
// state machine can be tested without GM.xmlHttpRequest or the network.
export type SaveToLibrary = (post: PostDetails) => Promise<void>

// The session liveness check and the library delete, injected the same way.
export type SessionCheck = (userId: number) => Promise<boolean>
export type DeleteFromLibrary = (postId: number) => Promise<void>

// The production session check: guests have no userId (and the button is
// hidden for guests anyway), so a missing user counts as not alive.
const productionSessionCheck: SessionCheck = (userId) =>
    userId > 0 ? sessionAlive(userId) : Promise.resolve(false)

// Generous on purpose: it must cover a full-resolution image on a slow
// connection and a large video on a decent one. It converts a hung
// download/upload into a retryable "library-failed" instead of an
// ever-"saving" button.
const LIBRARY_SAVE_TIMEOUT_MS = 10 * 60 * 1000

const productionSave: SaveToLibrary = (post) =>
    savePostToServer(post, gmFetchArrayBuffer, LIBRARY_SAVE_TIMEOUT_MS)

// Post ids with a library save in flight, mapped to the outcome promise
// (true = the post is in the library). One save runs at a time — the chain
// serializes the downloads + uploads so a burst of favorites doesn't fan them
// out — and the map is van state so a remounted details page (a gallery step)
// can show the in-flight post as "saving" instead of a fresh "idle" button
// that would start a duplicate save.
export const librarySaves = van.state<Map<number, Promise<boolean>>>(new Map())

let saveChain: Promise<void> = Promise.resolve()

// Run (or join) the library save for a post: download the media and upload
// it, then fold the post into the shared downloaded set so the grid badges
// and the button's "already" overlay pick it up. Resolves to the outcome
// instead of throwing, so a failure is a retryable button state, not an
// unhandled rejection.
function startLibrarySave(post: PostDetails, save: SaveToLibrary): Promise<boolean> {
    const inFlight = librarySaves.val.get(post.id)
    if (inFlight !== undefined) return inFlight

    const run = saveChain.then(async (): Promise<boolean> => {
        try {
            await save(post)
            markDownloaded([post.id])
            return true
        } catch (error) {
            console.warn(`Saving post ${post.id} to the arueshalae server failed`, error)
            return false
        }
    })

    const setInFlight = (id: number, task: Promise<boolean> | undefined) => {
        const next = new Map(librarySaves.val)
        if (task === undefined) next.delete(id)
        else next.set(id, task)
        librarySaves.val = next
    }

    const task = run.finally(() => setInFlight(post.id, undefined))
    setInFlight(post.id, task)
    saveChain = task.then(() => undefined)
    return task
}

// Keep the network lifecycle separate from the button markup so stale
// completions can be tested directly. The caller supplies an identity check
// for the post that started the request; navigation may reuse the same state
// object for another post while this request is in flight.
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
        if (isCurrent()) favorite.val = "idle" // network error; keep it retryable
        return
    }
    if (!isCurrent()) return

    if (result.ok === false && result.reason === "not-logged-in") {
        favorite.val = "idle" // stale session; the button is hidden anyway
        return
    }

    // Rule34 has the favorite (we added it, or it was already there) and
    // acked it — only now does the library mirror start, so a failure can
    // never leave the post on the server without rule34. The mirror skips
    // posts the server already holds.
    const endState: FavoriteStatus = result.ok ? "added" : "already"
    if (!serverSettings.val.enabled || downloaded.val.has(post.id)) {
        favorite.val = endState
        return
    }
    favorite.val = "saving"
    const saved = await startLibrarySave(post, save)
    if (!isCurrent()) return
    favorite.val = saved ? endState : "library-failed"
}

// Retry only the library part of a failed save (rule34 already holds the
// favorite — that's how "library-failed" is reached).
export async function retryLibrarySave(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    save: SaveToLibrary = productionSave,
): Promise<void> {
    if (!serverSettings.val.enabled) {
        // The server was disabled after the failure: accept the drift, the
        // post is a favorite either way.
        favorite.val = "already"
        return
    }
    favorite.val = "saving"
    const saved = await startLibrarySave(post, save)
    if (!isCurrent()) return
    favorite.val = saved ? "already" : "library-failed"
}

// Remove the favorite: rule34 is asked first (removing), and the library
// mirror is deleted only after rule34 dropped the favorite — the add flow's
// invariant in reverse, so a failure never deletes a post rule34 still
// holds. A 403 (not a favorite, or a dead session — the site can't tell the
// two apart) is disambiguated with a session check: alive, the post was
// simply already out of the favorites, so the mirror is still deleted (the
// intent is "out of both", and this self-heals a post removed on the site
// directly); dead, the button settles the per-mount terminal
// "stale-session" and the server is untouched.
export async function removeFavoriteWithStatus(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    remove: (id: number) => Promise<RemoveFavoriteResult> = removeFavorite,
    sessionCheck: SessionCheck = productionSessionCheck,
    del: DeleteFromLibrary = deletePostFromServer,
): Promise<void> {
    const pre = favorite.val // the face the user clicked; restored on failure
    favorite.val = "removing"
    let result: RemoveFavoriteResult
    try {
        result = await remove(post.id)
    } catch {
        if (isCurrent()) favorite.val = pre // network error; keep it retryable
        return
    }
    if (!isCurrent()) return

    if (!result.ok) {
        // A 403 conflates "not a favorite" with "session dead" — the site
        // can't tell them apart — so ask the site whether the session is
        // alive before deciding. The check always runs (guests pass userId
        // 0, which the production wrapper answers not alive — the button is
        // hidden for guests anyway).
        const a = auth.val
        const userId = a.status === "authenticated" ? a.userId : 0
        let alive: boolean
        try {
            alive = await sessionCheck(userId)
        } catch {
            // The check itself failed: an uninterpretable 403 is a failed,
            // retryable removal — never delete from the server on
            // uncertainty.
            if (isCurrent()) favorite.val = pre
            return
        }
        if (!isCurrent()) return
        if (!alive) {
            // TODO: route the user to the login screen (out of scope for now).
            favorite.val = "stale-session"
            return
        }
        // Session alive: the post simply isn't a favorite (removed on the
        // site directly, or the click raced reality). Fall through to the
        // mirror leg below.
    }

    // Mirror leg: delete the server's copy if it holds one. Skipped when the
    // server is off or doesn't hold the post; on failure the rule34 side is
    // already clean, so the retry (removal-failed) re-runs just the delete.
    if (!serverSettings.val.enabled || !downloaded.val.has(post.id)) {
        favorite.val = "idle"
        return
    }
    try {
        await del(post.id)
    } catch {
        if (isCurrent()) favorite.val = "removal-failed"
        return
    }
    if (!isCurrent()) return
    unmarkDownloaded(post.id)
    favorite.val = "idle"
}

// Retry only the library delete of a failed removal (rule34 already dropped
// the favorite — that's how "removal-failed" is reached).
export async function retryLibraryDelete(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    del: DeleteFromLibrary = deletePostFromServer,
): Promise<void> {
    if (!serverSettings.val.enabled) {
        // The server was disabled after the failure: accept the drift; the
        // post is no longer a favorite either way.
        favorite.val = "idle"
        return
    }
    favorite.val = "removing"
    try {
        await del(post.id)
    } catch {
        if (isCurrent()) favorite.val = "removal-failed"
        return
    }
    if (!isCurrent()) return
    unmarkDownloaded(post.id)
    favorite.val = "idle"
}

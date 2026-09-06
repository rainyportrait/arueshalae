import van, { type State } from "vanjs-core"

import { type AddFavoriteResult, addFavorite } from "../api/favorites.ts"
import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import type { PostDetails } from "../api/post-details.ts"
import { savePostToServer } from "../api/server.ts"
import { downloaded, markDownloaded } from "./downloaded.ts"
import { serverSettings } from "./settings.ts"

// The favorite button's lifecycle for the currently shown post. Rule34 acks
// the favorite first (idle -> adding -> added/already), and only then — when
// the server is enabled and the post isn't in the library yet — the library
// mirror runs (saving -> added/already). "library-failed" means rule34 holds
// the favorite but the server save failed: the recoverable direction (a
// future backfill can catch the gap), so the button retries just the library
// part.
export type FavoriteStatus = "idle" | "adding" | "saving" | "added" | "already" | "library-failed"

// The download + upload of the post's media to the server, injected so the
// state machine can be tested without GM.xmlHttpRequest or the network.
export type SaveToLibrary = (post: PostDetails) => Promise<void>

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

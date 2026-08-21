import { fetchFavorites } from "../api/favorites.ts"
import { type Post, fetchPostList } from "../api/post-list.ts"
import { type PostOrigin } from "../router.ts"
import { FAVORITES_PAGE_SIZE } from "./favorites.ts"
import { PAGE_SIZE } from "./list.ts"

// A loaded page of the collection.
export type GalleryPage = { pid: number; posts: Post[] }

// The public shape of the collection (no in-flight map); this is what the
// reactive layer publishes.
export type Gallery = {
    origin: PostOrigin
    // Loaded pages, sorted by pid; the flattened posts are the gallery order.
    pages: GalleryPage[]
    // The site's last-page offset for the collection; -1 until a page says.
    lastPagePID: number
}

// The live collection: the public shape plus the in-flight page map used for
// per-pid dedup. `version` counts real mutations (a page stored, lastPagePID
// updated) so the reactive layer can skip no-op publishes — a cache-hit step
// must not re-render the filmstrip (it would reset the strip's scroll).
// Exported so the reactive layer can type its helpers against it.
export type Collection = Gallery & { pending: Map<number, Promise<GalleryPage>>; version: number }

// The collection outlives individual postdetails navigations (each gallery
// step is a route change), so it lives in a module variable. It is plain data
// — no van.js — and the reactive layer (state/gallery.ts) publishes a snapshot
// of it whenever it changes.
let collection: Collection | null = null

// The identity of an origin: list posts are keyed by their search tags,
// favorites by the user id.
export function originKey(origin: PostOrigin): string {
    return origin.kind === "list" ? `list:${origin.tags ?? ""}` : `favorites:${origin.uid}`
}

export function pageSize(origin: PostOrigin): number {
    return origin.kind === "list" ? PAGE_SIZE : FAVORITES_PAGE_SIZE
}

// The live collection, or null before the first gallery route.
export function getCollection(): Collection | null {
    return collection
}

// Whether a collection is still the live one (out-of-order check: a page may
// settle after the user navigated to a different origin).
export function isCurrent(col: Collection): boolean {
    return col === collection
}

// A pending-free copy of a collection for the reactive layer to publish. The
// pages array is copied so the published snapshot has a fresh identity (van
// re-renders on a new object) and callers can't mutate the live pages.
export function snapshot(col: Collection): Gallery {
    return { origin: col.origin, pages: [...col.pages], lastPagePID: col.lastPagePID }
}

// Return the collection for this origin, creating a fresh one if the live
// collection is for a different origin.
export function collectionFor(origin: PostOrigin): Collection {
    if (collection !== null && originKey(collection.origin) === originKey(origin)) return collection
    collection = { origin, pages: [], lastPagePID: -1, pending: new Map(), version: 0 }
    return collection
}

function fetchPage(
    origin: PostOrigin,
    pid: number,
): Promise<{ posts: Post[]; lastPagePID: number }> {
    return origin.kind === "list"
        ? fetchPostList(origin.tags, pid).then((r) => ({
              posts: r.posts,
              lastPagePID: r.lastPagePID,
          }))
        : fetchFavorites(origin.uid, pid).then((r) => ({
              posts: r.posts,
              lastPagePID: r.lastPagePID,
          }))
}

// Load (or reuse) one page of the collection, deduplicated per pid. Mutates
// the collection on settle (only if it is still the live one) but performs no
// reactive side effects.
export function ensurePage(col: Collection, pid: number): Promise<GalleryPage> {
    const loaded = col.pages.find((p) => p.pid === pid)
    if (loaded !== undefined) return Promise.resolve(loaded)
    const inFlight = col.pending.get(pid)
    if (inFlight !== undefined) return inFlight

    const page = fetchPage(col.origin, pid).then(
        (result) => {
            col.pending.delete(pid)
            // The collection may have been replaced while the page loaded
            // (the user searched something else); only mutate it if it didn't.
            if (col !== collection) return { pid, posts: result.posts }
            // A successful fetch is always a state change worth publishing
            // (a stored page, or the empty-page clamp below possibly not
            // changing anything — still ends the loading skeleton).
            col.version++
            if (result.posts.length === 0) {
                // Empty page: the site's favorites last-page link can point a
                // page past the end (stale count). Clamp so boundary steps
                // stop here. The page is deliberately not stored, so a later
                // attempt (e.g. after new favorites) refetches it.
                const others = col.pages.map((p) => p.pid)
                col.lastPagePID = Math.max(
                    col.lastPagePID,
                    others.length > 0 ? Math.max(...others) : 0,
                )
                return { pid, posts: [] }
            }
            col.lastPagePID = Math.max(col.lastPagePID, result.lastPagePID)
            col.pages = [
                ...col.pages.filter((p) => p.pid !== pid),
                { pid, posts: result.posts },
            ].sort((a, b) => a.pid - b.pid)
            return col.pages.find((p) => p.pid === pid)!
        },
        (error: unknown) => {
            col.pending.delete(pid)
            throw error
        },
    )
    col.pending.set(pid, page)
    return page
}

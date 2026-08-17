import van from "vanjs-core"

import { fetchFavorites } from "../api/favorites.ts"
import { type Post, fetchPostList } from "../api/post-list.ts"
import { type PostOrigin, type Route, navigate, route } from "../router.ts"
import { FAVORITES_PAGE_SIZE } from "./favorites.ts"
import { PAGE_SIZE } from "./list.ts"
import { type Loadable } from "./load.ts"
import { cachedPostDetails } from "./post-details-cache.ts"

// A loaded page of the collection.
export type GalleryPage = { pid: number; posts: Post[] }

export type Gallery = {
    origin: PostOrigin
    // Loaded pages, sorted by pid; the flattened posts are the gallery order.
    pages: GalleryPage[]
    // The site's last-page offset for the collection; -1 until a page says.
    lastPagePID: number
}

export type GalleryState = Loadable<Gallery>

export const gallery = van.state<GalleryState>({ status: "loading" })

// Number of collection pages in flight; > 0 while a boundary step is loading
// the adjacent page.
export const pageLoads = van.state(0)

type PostDetailsRoute = Extract<Route, { type: "postdetails" }>

type Collection = Gallery & { pending: Map<number, Promise<GalleryPage>> }

// The collection outlives individual postdetails navigations (each gallery
// step is a route change), so it lives in a module variable; `gallery` is a
// fresh snapshot of it on every change, which is what makes the UI reactive.
let collection: Collection | null = null
// Out-of-order protection for the origin-page load (fast steps, searches).
let seq = 0

function originKey(origin: PostOrigin): string {
    return origin.kind === "list" ? `list:${origin.tags ?? ""}` : `favorites:${origin.uid}`
}

function pageSize(origin: PostOrigin): number {
    return origin.kind === "list" ? PAGE_SIZE : FAVORITES_PAGE_SIZE
}

function collectionFor(origin: PostOrigin): Collection {
    if (collection !== null && originKey(collection.origin) === originKey(origin)) return collection
    collection = { origin, pages: [], lastPagePID: -1, pending: new Map() }
    return collection
}

// Publish a fresh snapshot; van's state setter only re-renders on a new
// object, so in-place collection mutations need this to be seen.
function publish(col: Collection): void {
    gallery.val = {
        status: "ready",
        origin: col.origin,
        pages: [...col.pages],
        lastPagePID: col.lastPagePID,
    }
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

// Load (or reuse) one page of the collection, deduplicated per pid.
function ensurePage(col: Collection, pid: number): Promise<GalleryPage> {
    const loaded = col.pages.find((p) => p.pid === pid)
    if (loaded !== undefined) return Promise.resolve(loaded)
    const inFlight = col.pending.get(pid)
    if (inFlight !== undefined) return inFlight

    const page = fetchPage(col.origin, pid).then(
        (result) => {
            col.pending.delete(pid)
            pageLoads.val -= 1
            // The collection may have been replaced while the page loaded
            // (the user searched something else); only publish if it didn't.
            if (col !== collection) return { pid, posts: result.posts }
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
                publish(col)
                return { pid, posts: [] }
            }
            col.lastPagePID = Math.max(col.lastPagePID, result.lastPagePID)
            col.pages = [
                ...col.pages.filter((p) => p.pid !== pid),
                { pid, posts: result.posts },
            ].sort((a, b) => a.pid - b.pid)
            publish(col)
            return col.pages.find((p) => p.pid === pid)!
        },
        (error: unknown) => {
            col.pending.delete(pid)
            pageLoads.val -= 1
            throw error
        },
    )
    col.pending.set(pid, page)
    pageLoads.val += 1
    return page
}

// Load the origin page whenever a gallery-enabled post details route shows.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    loadOrigin(r.origin)
})

function loadOrigin(origin: PostOrigin): void {
    const current = ++seq
    const col = collectionFor(origin)
    if (col.pages.some((p) => p.pid === origin.pid)) {
        publish(col)
        return
    }
    gallery.val = { status: "loading" }
    void ensurePage(col, origin.pid).then(
        () => {
            if (current === seq) publish(col)
        },
        (error: unknown) => {
            if (current === seq) {
                gallery.val = { status: "error", error: errorMessage(error) }
            }
        },
    )
}

export function reloadGallery(): void {
    const r = route.val
    if (r.type === "postdetails" && r.origin !== undefined) loadOrigin(r.origin)
}

// Step to the adjacent post in the collection. Inside a loaded page this is a
// plain navigation; at a page boundary the adjacent page is fetched first and
// the step lands on its first/last post.
export function step(delta: 1 | -1): void {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined || collection === null) return
    if (originKey(collection.origin) !== originKey(r.origin)) return
    const col = collection
    const posts = col.pages.flatMap((p) => p.posts)
    const index = posts.findIndex((p) => p.id === r.id)
    if (index === -1) return
    const size = pageSize(r.origin)
    const target = index + delta
    if (target >= 0 && target < posts.length) {
        navigate({ ...r, id: posts[target].id })
        return
    }
    const pids = col.pages.map((p) => p.pid)
    if (delta === 1 && pids.length > 0 && Math.max(...pids) + size <= col.lastPagePID) {
        void boundaryStep(col, Math.max(...pids) + size, r, (page) => page[0])
    } else if (delta === -1 && pids.length > 0 && Math.min(...pids) - size >= 0) {
        void boundaryStep(col, Math.min(...pids) - size, r, (page) => page[page.length - 1])
    }
}

function boundaryStep(
    col: Collection,
    pid: number,
    r: PostDetailsRoute,
    pick: (posts: Post[]) => Post | undefined,
): void {
    void ensurePage(col, pid).then(
        (page) => {
            // The collection may have been replaced while the page loaded
            // (the user searched something else); only step if it didn't.
            if (col !== collection) return
            const target = pick(page.posts)
            if (target !== undefined) navigate({ ...r, id: target.id })
        },
        () => {
            // A failed boundary fetch is silent; the button stays enabled
            // and the next press retries.
        },
    )
}

// Whether a step in the given direction is possible right now.
export function canStep(delta: 1 | -1): boolean {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined || collection === null) return false
    if (originKey(collection.origin) !== originKey(r.origin)) return false
    const col = collection
    const posts = col.pages.flatMap((p) => p.posts)
    const index = posts.findIndex((p) => p.id === r.id)
    if (index === -1) return false
    const size = pageSize(r.origin)
    const pids = col.pages.map((p) => p.pid)
    if (delta === 1) {
        return (
            index < posts.length - 1 ||
            (pids.length > 0 && Math.max(...pids) + size <= col.lastPagePID)
        )
    }
    return index > 0 || (pids.length > 0 && Math.min(...pids) - size >= 0)
}

// Prefetch the details of the two adjacent loaded posts, so arrow-stepping
// renders instantly (the details cache makes repeat fetches free).
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    const g = gallery.val
    if (g.status !== "ready") return
    const posts = g.pages.flatMap((p) => p.posts)
    const index = posts.findIndex((p) => p.id === r.id)
    if (index === -1) return
    const prev = posts[index - 1]
    const next = posts[index + 1]
    if (prev !== undefined) void cachedPostDetails(prev.id)
    if (next !== undefined) void cachedPostDetails(next.id)
})

// Arrow keys step through the gallery. Installed once at module load; the
// handler bails outside a gallery-enabled post details page and while the
// user is typing in a form field (e.g. the search bar).
document.addEventListener("keydown", (event) => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    const el = event.target
    if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
    ) {
        return
    }
    if (event.key === "ArrowRight") {
        event.preventDefault()
        step(1)
    } else if (event.key === "ArrowLeft") {
        event.preventDefault()
        step(-1)
    }
})

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

import van from "vanjs-core"

import { type PostOrigin, type Route, navigate, route } from "../router.ts"
import {
    type Collection,
    type Gallery,
    type GalleryPage,
    type LoadedPost,
    collectionFor,
    ensurePage,
    getCollection,
    isCurrent,
    loadedPosts,
    originKey,
    pageSize,
    snapshot,
} from "./gallery-collection.ts"
import { type Loadable, errorMessage } from "./load.ts"
import { cachedPostDetails } from "./post-details-cache.ts"

export type { Gallery, GalleryPage } from "./gallery-collection.ts"

export type GalleryState = Loadable<Gallery>

export const gallery = van.state<GalleryState>({ status: "loading" })

// Focus mode: hides the app navbar and the post's metadata sidebar so the
// gallery fills the screen. Only meaningful on a gallery post (a postdetails
// route with an origin); the derive below force-turns it off the moment the
// route leaves one, so it never survives leaving the gallery.
export const galleryFocus = van.state(false)

type PostDetailsRoute = Extract<Route, { type: "postdetails" }>
type GalleryPostDetailsRoute = PostDetailsRoute & { origin: PostOrigin }

// Everything a gallery step needs to know about the current position: the
// route, its collection, the loaded posts, the active post's index, the page
// size, and the first/last pages (sorted by pid, so the extremes are the
// collection's edges). Null when not on a gallery-enabled postdetails route,
// before the collection exists, when the collection is for another origin,
// or when the active post isn't among the loaded posts.
function stepContext(): {
    r: GalleryPostDetailsRoute
    col: Collection
    posts: LoadedPost[]
    index: number
    size: number
    first: GalleryPage | undefined
    last: GalleryPage | undefined
} | null {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return null
    const origin = r.origin
    const col = getCollection()
    if (col === null || originKey(col.origin) !== originKey(origin)) return null
    const posts = loadedPosts(col)
    const index = posts.findIndex((entry) => entry.post.id === r.id)
    if (index === -1) return null
    return {
        r: { ...r, origin },
        col,
        posts,
        index,
        size: pageSize(origin),
        first: col.pages[0],
        last: col.pages.at(-1),
    }
}

// Out-of-order protection for the origin-page load (fast steps, searches).
let seq = 0

// Publish a fresh snapshot of the live collection. van's state setter only
// re-renders on a new object, so a snapshot taken here (a new object every
// call) is what makes the in-place collection mutations in
// state/gallery-collection.ts visible to the UI. Skipped when nothing has
// changed since the last publish (the collection's version is unchanged): a
// gallery step within loaded pages must not touch `gallery` — re-rendering
// the filmstrip would reset its scroll position.
let published: { col: Collection; version: number } | null = null
function publish(): void {
    const col = getCollection()
    if (col === null) return
    if (published !== null && published.col === col && published.version === col.version) return
    published = { col, version: col.version }
    gallery.val = { status: "ready", ...snapshot(col) }
}

// Load the origin page whenever a gallery-enabled post details route shows.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    loadOrigin(r.origin)
})

// Focus mode only exists in a gallery: turn it off whenever the route is not a
// gallery post. Reads only `route`, so the write back to `galleryFocus` never
// re-triggers this derive.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) galleryFocus.val = false
})

function loadOrigin(origin: PostOrigin): void {
    const current = ++seq
    const col = collectionFor(origin)
    const originPage = col.pages.find((p) => p.pid === origin.pid)
    if (originPage === undefined) {
        // The loading state below bypasses publish()'s version tracking, so
        // force the next publish() to run even if the collection's version is
        // unchanged — its settle must replace the loading state.
        published = null
        gallery.val = { status: "loading" }
    }
    void (
        originPage === undefined ? ensurePage(col, origin.pid) : Promise.resolve(originPage)
    ).then(
        () => {
            if (current !== seq) return
            publish()
            void findActivePost(col, origin, current)
        },
        (error: unknown) => {
            if (current === seq) {
                published = null
                gallery.val = { status: "error", error: errorMessage(error) }
            }
        },
    )
}

// A hard cap on the page searches below (the active-post search and boundary
// steps). The origin page is a fresh fetch, but
// the list page the post was opened from is an older snapshot: on a busy feed
// newer posts may have pushed the post onto a later page in between. The post
// is then missing from the collection, stepContext() bails, and both arrows
// sit disabled with no way to reach the post. Load the following pages until
// the post turns up — each settled page is published, so the filmstrip grows
// as it does on a boundary step — or the collection ends with an empty page,
// the route moves on, or the limit is reached (a guard against runaway fetches
// if the post is truly gone from the collection).
const FIND_POST_PAGE_LIMIT = 10

async function findActivePost(col: Collection, origin: PostOrigin, current: number): Promise<void> {
    for (let offset = 1; offset <= FIND_POST_PAGE_LIMIT; offset++) {
        if (current !== seq || !isCurrent(col)) return
        const r = route.val
        if (
            r.type !== "postdetails" ||
            r.origin === undefined ||
            originKey(r.origin) !== originKey(origin)
        )
            return
        if (stepContext() !== null) return
        let page: GalleryPage
        try {
            page = await ensurePage(col, origin.pid + offset * pageSize(origin))
        } catch {
            // A failed fetch aborts the search; the arrows stay disabled.
            return
        }
        // The route may have moved on while the page loaded. A step within
        // the same origin still owns the collection: publish the page like
        // boundaryStep does, so the filmstrip keeps growing. A different
        // origin replaced the collection (the page was never stored): bail.
        if (!isCurrent(col)) return
        publish()
        if (page.posts.length === 0 || current !== seq) return
    }
}

export function reloadGallery(): void {
    const r = route.val
    if (r.type === "postdetails" && r.origin !== undefined) loadOrigin(r.origin)
}

// Step to the adjacent post in the collection. Each step is a replace
// navigation (the URL changes but no history entry is added, so the browser
// back button exits the gallery); at a page boundary the adjacent page is
// fetched first and the step lands on the first post in the direction that
// the filmstrip doesn't show yet (see boundaryStep).
export function step(delta: 1 | -1): void {
    const ctx = stepContext()
    if (ctx === null) return
    const target = ctx.posts[ctx.index + delta]
    if (target !== undefined) {
        navigate(
            {
                ...ctx.r,
                id: target.post.id,
                // The entry carries the page the post came from, so the
                // origin pid can follow the post without a page lookup.
                origin: { ...ctx.r.origin, pid: target.pid },
            },
            { replace: true },
        )
        return
    }
    if (delta === 1 && ctx.last !== undefined && ctx.last.pid + ctx.size <= ctx.col.lastPagePID) {
        startBoundaryStep(ctx.col, ctx.last.pid + ctx.size, ctx.r, 1)
    } else if (delta === -1 && ctx.first !== undefined && ctx.first.pid - ctx.size >= 0) {
        startBoundaryStep(ctx.col, ctx.first.pid - ctx.size, ctx.r, -1)
    }
}

// Boundary searches in flight, per collection: rapid presses shouldn't
// stack redundant fetch loops on the same boundary (a second press would
// land on the same post as the first anyway).
const boundaryStepsInFlight = new Set<Collection>()

function startBoundaryStep(
    col: Collection,
    pid: number,
    r: GalleryPostDetailsRoute,
    dir: 1 | -1,
): void {
    if (boundaryStepsInFlight.has(col)) return
    boundaryStepsInFlight.add(col)
    void boundaryStep(col, pid, r, dir).finally(() => {
        boundaryStepsInFlight.delete(col)
    })
}

// At a page boundary, fetch the adjacent page, publish it (so the filmstrip
// grows), then land on its first post in the step direction that the filmstrip
// doesn't show yet. The feed can shift between fetches, so the new page's edge
// posts can duplicate already-loaded pages (the same post in two pid windows):
// the step skips those to the first fresh post. A page that is entirely
// duplicates (the feed shifted more than a page size) fetches the next one in
// the step direction instead — the same bounded search as findActivePost.
async function boundaryStep(
    col: Collection,
    pid: number,
    r: GalleryPostDetailsRoute,
    dir: 1 | -1,
): Promise<void> {
    const size = pageSize(r.origin)
    for (let attempt = 0; attempt < FIND_POST_PAGE_LIMIT; attempt++) {
        if (!isCurrent(col)) return
        let page: GalleryPage
        try {
            page = await ensurePage(col, pid)
        } catch {
            // A failed boundary fetch is silent; the button stays enabled
            // and the next press retries.
            return
        }
        // The collection may have been replaced while the page loaded
        // (the user searched something else); only act if it didn't.
        if (!isCurrent(col)) return
        publish()
        // Everything the filmstrip already showed: all loaded pages except
        // this one (a shifted feed can repeat this page's posts under other
        // pids; those copies are visible, so they count as seen).
        const seen = new Set<number>()
        for (const stored of col.pages)
            if (stored.pid !== page.pid) for (const post of stored.posts) seen.add(post.id)
        const candidates = dir === 1 ? page.posts : [...page.posts].reverse()
        const target = candidates.find((post) => !seen.has(post.id))
        if (target !== undefined) {
            navigate(
                { ...r, id: target.id, origin: { ...r.origin, pid: page.pid } },
                { replace: true },
            )
            return
        }
        // The whole page is duplicates: nothing fresh to land on. An empty
        // page marks the collection's edge; otherwise keep fetching in the
        // step direction.
        if (page.posts.length === 0) return
        pid += dir * size
        if (pid < 0) return
    }
}

export function canStep(delta: 1 | -1): boolean {
    const ctx = stepContext()
    if (ctx === null) return false
    if (delta === 1) {
        return (
            ctx.index < ctx.posts.length - 1 ||
            (ctx.last !== undefined && ctx.last.pid + ctx.size <= ctx.col.lastPagePID)
        )
    }
    return ctx.index > 0 || (ctx.first !== undefined && ctx.first.pid - ctx.size >= 0)
}

// Prefetch the details of the two adjacent loaded posts, so arrow-stepping
// renders instantly (the details cache makes repeat fetches free).
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    const g = gallery.val
    if (g.status !== "ready") return
    const posts = loadedPosts(g)
    const index = posts.findIndex((entry) => entry.post.id === r.id)
    if (index === -1) return
    const prev = posts[index - 1]
    const next = posts[index + 1]
    if (prev !== undefined) void cachedPostDetails(prev.post.id)
    if (next !== undefined) void cachedPostDetails(next.post.id)
})

// Gallery keys. Installed once at module load; the handler bails outside a
// gallery-enabled post details page, while the user is typing in a form
// field (e.g. the search bar), and on modified keys — the browser owns the
// Ctrl/Cmd/Alt combinations (history navigation, in-page find, close).
// - ArrowRight/ArrowLeft step through the gallery
// - F toggles focus mode, Escape closes it
document.addEventListener("keydown", (event) => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
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
    } else if (event.key === "f" || event.key === "F") {
        galleryFocus.val = !galleryFocus.val
    } else if (event.key === "Escape" && galleryFocus.val) {
        galleryFocus.val = false
    }
})

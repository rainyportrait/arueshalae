import van from "vanjs-core"

import { type Post } from "../api/post-list.ts"
import { type PostOrigin, type Route, navigate, route } from "../router.ts"
import {
    type Collection,
    type Gallery,
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
    if (col.pages.some((p) => p.pid === origin.pid)) {
        publish()
        return
    }
    // Not tracked as published: the next publish() must run even if the
    // collection's version didn't change (e.g. a step onto an in-flight page
    // came back via the cache-hit path above).
    published = null
    gallery.val = { status: "loading" }
    void ensurePage(col, origin.pid).then(
        () => {
            if (current === seq) publish()
        },
        (error: unknown) => {
            if (current === seq) {
                published = null
                gallery.val = { status: "error", error: errorMessage(error) }
            }
        },
    )
}

export function reloadGallery(): void {
    const r = route.val
    if (r.type === "postdetails" && r.origin !== undefined) loadOrigin(r.origin)
}

// Step to the adjacent post in the collection. Inside a loaded page this is
// a replace navigation (the URL changes but no history entry is added, so
// the browser back button exits the gallery); at a page boundary the
// adjacent page is fetched first and the step lands on its first/last post.
export function step(delta: 1 | -1): void {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    const col = getCollection()
    if (col === null) return
    if (originKey(col.origin) !== originKey(r.origin)) return
    const posts = loadedPosts(col)
    const index = posts.findIndex((p) => p.id === r.id)
    if (index === -1) return
    const size = pageSize(r.origin)
    const target = index + delta
    if (target >= 0 && target < posts.length) {
        // Replace, not push: gallery steps shouldn't pile up in the history,
        // so the browser back button exits the gallery to the list.
        navigate({ ...r, id: posts[target].id }, { replace: true })
        return
    }
    // Pages are sorted by pid, so the extremes are the first and last page.
    const first = col.pages[0]
    const last = col.pages[col.pages.length - 1]
    if (delta === 1 && last !== undefined && last.pid + size <= col.lastPagePID) {
        void boundaryStep(col, last.pid + size, r, (page) => page[0])
    } else if (delta === -1 && first !== undefined && first.pid - size >= 0) {
        void boundaryStep(col, first.pid - size, r, (page) => page[page.length - 1])
    }
}

// At a page boundary, fetch the adjacent page, publish it (so the filmstrip
// grows), then land on its first/last post. A failed boundary fetch is silent;
// the button stays enabled and the next press retries.
function boundaryStep(
    col: Collection,
    pid: number,
    r: PostDetailsRoute,
    pick: (posts: Post[]) => Post | undefined,
): void {
    void ensurePage(col, pid).then(
        (pageData) => {
            // The collection may have been replaced while the page loaded
            // (the user searched something else); only act if it didn't.
            if (!isCurrent(col)) return
            publish()
            const target = pick(pageData.posts)
            if (target !== undefined) navigate({ ...r, id: target.id }, { replace: true })
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
    if (r.type !== "postdetails" || r.origin === undefined) return false
    const col = getCollection()
    if (col === null) return false
    if (originKey(col.origin) !== originKey(r.origin)) return false
    const posts = loadedPosts(col)
    const index = posts.findIndex((p) => p.id === r.id)
    if (index === -1) return false
    const size = pageSize(r.origin)
    // Pages are sorted by pid, so the extremes are the first and last page.
    const first = col.pages[0]
    const last = col.pages[col.pages.length - 1]
    if (delta === 1) {
        return (
            index < posts.length - 1 || (last !== undefined && last.pid + size <= col.lastPagePID)
        )
    }
    return index > 0 || (first !== undefined && first.pid - size >= 0)
}

// Prefetch the details of the two adjacent loaded posts, so arrow-stepping
// renders instantly (the details cache makes repeat fetches free).
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails" || r.origin === undefined) return
    const g = gallery.val
    if (g.status !== "ready") return
    const posts = loadedPosts(g)
    const index = posts.findIndex((p) => p.id === r.id)
    if (index === -1) return
    const prev = posts[index - 1]
    const next = posts[index + 1]
    if (prev !== undefined) void cachedPostDetails(prev.id)
    if (next !== undefined) void cachedPostDetails(next.id)
})

// Gallery keys. Installed once at module load; the handler bails outside a
// gallery-enabled post details page and while the user is typing in a form
// field (e.g. the search bar).
// - ArrowRight/ArrowLeft step through the gallery
// - F opens focus mode, Escape closes it
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
    } else if (event.key === "f" || event.key === "F") {
        galleryFocus.val = true
    } else if (event.key === "Escape" && galleryFocus.val) {
        galleryFocus.val = false
    }
})

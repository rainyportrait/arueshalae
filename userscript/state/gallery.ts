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
    originKey,
    pageSize,
    snapshot,
} from "./gallery-collection.ts"
import { type Loadable } from "./load.ts"
import { cachedPostDetails } from "./post-details-cache.ts"

export type { Gallery, GalleryPage } from "./gallery-collection.ts"

export type GalleryState = Loadable<Gallery>

export const gallery = van.state<GalleryState>({ status: "loading" })

type PostDetailsRoute = Extract<Route, { type: "postdetails" }>

// Out-of-order protection for the origin-page load (fast steps, searches).
let seq = 0

// Publish a fresh snapshot of the live collection. van's state setter only
// re-renders on a new object, so a snapshot taken here (a new object every
// call) is what makes the in-place collection mutations in
// state/gallery-collection.ts visible to the UI.
function publish(): void {
    const col = getCollection()
    if (col === null) return
    gallery.val = { status: "ready", ...snapshot(col) }
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
        publish()
        return
    }
    gallery.val = { status: "loading" }
    void ensurePage(col, origin.pid).then(
        () => {
            if (current === seq) publish()
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
    const posts = col.pages.flatMap((p) => p.posts)
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
    const pids = col.pages.map((p) => p.pid)
    if (delta === 1 && pids.length > 0 && Math.max(...pids) + size <= col.lastPagePID) {
        void boundaryStep(col, Math.max(...pids) + size, r, (page) => page[0])
    } else if (delta === -1 && pids.length > 0 && Math.min(...pids) - size >= 0) {
        void boundaryStep(col, Math.min(...pids) - size, r, (page) => page[page.length - 1])
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

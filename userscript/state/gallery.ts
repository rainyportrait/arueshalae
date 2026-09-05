import van from "vanjs-core"

import { type Post } from "../api/post-list.ts"
import { type PostOrigin, type Route, navigate, route } from "../router.ts"
import {
    type Collection,
    type Gallery,
    type GalleryPage,
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
    posts: Post[]
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
    const index = posts.findIndex((p) => p.id === r.id)
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
    const ctx = stepContext()
    if (ctx === null) return
    const target = ctx.index + delta
    if (target >= 0 && target < ctx.posts.length) {
        const targetPost = ctx.posts[target]
        const targetPage = ctx.col.pages.find((page) =>
            page.posts.some((post) => post.id === targetPost.id),
        )
        // Replace, not push: gallery steps shouldn't pile up in the history,
        // so the browser back button exits the gallery to the list.
        navigate(
            {
                ...ctx.r,
                id: targetPost.id,
                origin:
                    targetPage === undefined
                        ? ctx.r.origin
                        : { ...ctx.r.origin, pid: targetPage.pid },
            },
            { replace: true },
        )
        return
    }
    if (delta === 1 && ctx.last !== undefined && ctx.last.pid + ctx.size <= ctx.col.lastPagePID) {
        void boundaryStep(ctx.col, ctx.last.pid + ctx.size, ctx.r, (page) => page[0])
    } else if (delta === -1 && ctx.first !== undefined && ctx.first.pid - ctx.size >= 0) {
        void boundaryStep(ctx.col, ctx.first.pid - ctx.size, ctx.r, (page) => page.at(-1))
    }
}

// At a page boundary, fetch the adjacent page, publish it (so the filmstrip
// grows), then land on its first/last post.
function boundaryStep(
    col: Collection,
    pid: number,
    r: GalleryPostDetailsRoute,
    pick: (posts: Post[]) => Post | undefined,
): void {
    void ensurePage(col, pid).then(
        (pageData) => {
            // The collection may have been replaced while the page loaded
            // (the user searched something else); only act if it didn't.
            if (!isCurrent(col)) return
            publish()
            const target = pick(pageData.posts)
            if (target !== undefined)
                navigate({ ...r, id: target.id, origin: { ...r.origin, pid } }, { replace: true })
        },
        () => {
            // A failed boundary fetch is silent; the button stays enabled
            // and the next press retries.
        },
    )
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
// - F toggles focus mode, Escape closes it
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
        galleryFocus.val = !galleryFocus.val
    } else if (event.key === "Escape" && galleryFocus.val) {
        galleryFocus.val = false
    }
})

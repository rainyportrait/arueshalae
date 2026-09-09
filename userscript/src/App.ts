import van from "vanjs-core"

import { Account } from "./Account.ts"
import { Favorites } from "./Favorites.ts"
import { Login } from "./Login.ts"
import { Navbar } from "./Navbar.ts"
import { NotFound } from "./Placeholders.ts"
import { PostDetails } from "./PostDetails.ts"
import { PostList } from "./PostList.ts"
import { Settings } from "./Settings.ts"
import { CaptchaModal } from "./captcha.ts"
import clsx from "./clsx.ts"
import { initMasonry } from "./masonry.ts"
import { type Route, route } from "./router.ts"
import { profile, profileLoading } from "./state/account.ts"
import { details, detailsLoading } from "./state/details.ts"
import { favorites, favoritesLoading } from "./state/favorites.ts"
import { galleryFocus } from "./state/gallery.ts"
import { list, listLoading } from "./state/list.ts"
import { pageLoading } from "./state/loading.ts"
import { applyRestore, rememberScroll, scrollRestore } from "./state/scroll.ts"

const { div, main } = van.tags

// The indeterminate loading bar pinned to the top of the viewport while a
// page fetches its data. A comment keeps the binding alive when hidden (a
// live node must never return null).
function LoadingBar() {
    return () => {
        if (!pageLoading.val) return document.createComment("")
        return div(
            { class: "pointer-events-none fixed inset-x-0 top-0 z-100 h-0.5" },
            div({ class: "loading-bar" }),
        )
    }
}

// The route type of the page that is actually on screen. `route` changes
// immediately when the user navigates (fetches start, the navbar updates),
// but the visible page only swaps once the target page has settled: crossing
// to a type that is still fetching keeps the old page up, with the loading
// bar, and this state catches up when the fetch settles. An error counts as
// settled, so the error screen (with retry) replaces the old page instead of
// holding it forever.
//
// screenReady asks for a payload that belongs to the current route (the ready
// payload records the route it was loaded with — the list's `pid`/`query`),
// not merely for "not loading": a replay (state/list.ts) can therefore flip
// the screen instantly to a cached page, revalidation in flight or not,
// while a fetch for a different route keeps the previous page up until it
// settles. (Without a replay, a ready payload always belongs to the previous
// route right after a route change, so the two formulations agree.)
const shownType = van.state<Route["type"]>(route.val.type)

function screenReady(t: Route["type"]): boolean {
    switch (t) {
        case "postlist": {
            const r = route.val
            return (
                r.type === "postlist" &&
                list.val.status === "ready" &&
                list.val.pid === r.pid &&
                list.val.query === r.tags
            )
        }
        case "postdetails":
            return !detailsLoading.val && details.val.status !== "loading"
        case "favorites":
            return !favoritesLoading.val && favorites.val.status !== "loading"
        case "account":
            return !profileLoading.val && profile.val.status !== "loading"
        default:
            return true // login, settings, unknown: nothing to fetch
    }
}

van.derive(() => {
    const t = route.val.type
    if (t !== shownType.val && screenReady(t)) {
        shownType.val = t
        // A different page type is a full page change. Every content-driven
        // navigation queues a top restore (router.ts), which the restore
        // derive below applies; this immediate scroll is only the fallback
        // for a traversal onto a different-type page with no remembered
        // offset (an entry the app never navigated to itself).
        if (scrollRestore.val === null) window.scrollTo(0, 0)
    }
})

// Apply the pending scroll restore (state/scroll.ts) — the remembered
// offset of a history traversal or the top that every content-driven
// navigation asks for — as soon as the page the route points at is on
// screen: the shown type has caught up (a cross-type back waits for the
// target to settle or replay) and its data isn't loading. A same-type
// traversal (back one page) never flips the shown type, so only this derive
// restores there.
van.derive(() => {
    if (scrollRestore.val === null) return
    const t = route.val.type
    if (shownType.val === t && screenReady(t)) applyRestore()
})

// Keep the current history entry's remembered offset fresh (state/scroll.ts):
// rAF-throttled, and only while the screen shows the current route's settled
// page — mid-fetch it still shows the previous page, and that offset belongs
// to that page's entry, not the one the route already points at.
let scrollCaptureQueued = false
window.addEventListener(
    "scroll",
    () => {
        if (scrollCaptureQueued) return
        scrollCaptureQueued = true
        requestAnimationFrame(() => {
            scrollCaptureQueued = false
            const t = route.val.type
            if (shownType.val === t && screenReady(t)) rememberScroll()
        })
    },
    { passive: true },
)

function makePage(type: Route["type"]): Node {
    switch (type) {
        case "postlist":
            return PostList()
        case "postdetails":
            return PostDetails()
        case "login":
            return Login()
        case "favorites":
            return Favorites()
        case "account":
            return Account()
        case "settings":
            return Settings()
        case "unknown":
            return NotFound()
    }
}

function ArueApp() {
    // The page is memoized only while its type is on screen: a same-type
    // navigation (search, page turn, gallery step) reuses the node, and the
    // page's own live bindings handle the update — a fresh node would be
    // swapped in by vanjs and rebuild the whole subtree (every <img> reloads,
    // a visible flash). A different type rebuilds the page from scratch: vanjs
    // permanently drops any binding whose `_dom` is disconnected when one of
    // its subscribed states changes (keepConnected, vanjs-core), so a node
    // that was detached once is dead on re-attach and must never be reused.
    let current: { type: Route["type"]; node: Node } | undefined
    const mainContent = (): Node => {
        const t = shownType.val
        if (current?.type !== t) current = { type: t, node: makePage(t) }
        return current.node
    }

    return div(
        {
            // In focus mode the root is pinned to the *dynamic* viewport
            // (h-dvh): min-h-screen would size it to 100vh, which on mobile
            // Safari is the large viewport — taller than the visible area
            // while the address bar is showing — and flex-1 would stretch
            // main to it, making the page scrollable below the media.
            class: () =>
                clsx(
                    "flex flex-col bg-zinc-950 text-zinc-100",
                    galleryFocus.val ? "h-dvh" : "min-h-screen",
                ),
        },
        Navbar(),
        LoadingBar(),
        main(
            {
                // Focus mode drops the padding so the media column can run edge
                // to edge under the hidden navbar.
                class: () => clsx("mx-auto w-full flex-1", !galleryFocus.val && "p-2.5"),
            },
            mainContent,
        ),
    )
}

export function initApp(): void {
    document.body.innerHTML = ""
    van.add(document.body, ArueApp())
    van.add(document.body, CaptchaModal())
    // Card spans are pixel values measured at load time, and card height
    // follows the column width, so resize needs a re-measure (masonry.ts).
    initMasonry()
    // Focus mode also needs the document itself non-scrollable: html/body
    // carry min-height: 100% against the large viewport, which alone would
    // keep the page scrollable (see the body.arue-focus rule in
    // styles.css).
    van.derive(() => {
        document.body.classList.toggle("arue-focus", galleryFocus.val)
    })
}

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
import { type Route, route } from "./router.ts"
import { profile, profileLoading } from "./state/account.ts"
import { details, detailsLoading } from "./state/details.ts"
import { favorites, favoritesLoading } from "./state/favorites.ts"
import { list, listLoading } from "./state/list.ts"
import { pageLoading } from "./state/loading.ts"

const { div, main } = van.tags

// The indeterminate loading bar pinned to the top of the viewport while a
// page fetches its data. A comment keeps the binding alive when hidden (a
// live node must never return null).
function LoadingBar() {
    return () => {
        if (!pageLoading.val) return document.createComment("")
        return div(
            { class: clsx("pointer-events-none fixed inset-x-0 top-0 z-100 h-0.5") },
            div({ class: clsx("loading-bar") }),
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
// A stale "ready" payload can never satisfy screenReady: the state modules
// are imported before this one, so their trigger derives are registered first
// and bump their pending flag before this derive evaluates, right after a
// route change.
const shownType = van.state<Route["type"]>(route.val.type)

function screenReady(t: Route["type"]): boolean {
    switch (t) {
        case "postlist":
            return !listLoading.val && list.val.status !== "loading"
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
    if (t !== shownType.val && screenReady(t)) shownType.val = t
})

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
        { class: clsx("flex min-h-screen flex-col bg-zinc-950 text-zinc-100") },
        Navbar(),
        LoadingBar(),
        main({ class: clsx("mx-auto w-full flex-1 p-2.5") }, mainContent),
    )
}

export function initApp(): void {
    document.body.innerHTML = ""
    van.add(document.body, ArueApp())
    van.add(document.body, CaptchaModal())
}

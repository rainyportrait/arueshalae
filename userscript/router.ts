import van from "vanjs-core"

import { positiveInt } from "./api/parse.ts"

// A route is a parsed view of the current URL. The rule34.xxx URL scheme
// discriminates on the (page, s) query pair; we map that onto a discriminated
// union. Anything we don't recognize explicitly is `unknown` (rendered as 404).
export type Route =
    | { type: "postlist"; tags: string | undefined; pid: number }
    | { type: "postdetails"; id: number }
    // An account can be addressed by numeric id or by username; the site
    // resolves both. We keep whichever the URL carried.
    | { type: "account"; id: number }
    | { type: "account"; uname: string }
    | { type: "favorites"; id: number }
    | { type: "settings" }
    | { type: "login" }
    | { type: "unknown" }

const BASE = "/index.php"

// Total URL -> Route parser. Accepts a relative or absolute URL.
export function parseRoute(url: string): Route {
    const params = new URL(url, window.location.origin).searchParams
    const page = params.get("page")
    const s = params.get("s")

    if (page === "post" && s === "list") {
        const pidRaw = params.get("pid")
        const pidNum = pidRaw === null ? 0 : Number(pidRaw)
        const pid = Number.isFinite(pidNum) && pidNum > 0 ? Math.trunc(pidNum) : 0
        return { type: "postlist", tags: params.get("tags") ?? undefined, pid }
    }
    if (page === "post" && s === "view") {
        const id = positiveInt(params.get("id"))
        return id === null ? { type: "unknown" } : { type: "postdetails", id }
    }
    if (page === "account" && s === "profile") {
        const id = positiveInt(params.get("id"))
        if (id !== null) return { type: "account", id }
        const uname = params.get("uname")
        if (uname !== null && uname !== "") return { type: "account", uname }
        return { type: "unknown" }
    }
    if (page === "favorites" && s === "view") {
        const id = positiveInt(params.get("id"))
        return id === null ? { type: "unknown" } : { type: "favorites", id }
    }
    if (page === "account" && s === "options") {
        return { type: "settings" }
    }
    // The `code` value is ignored for routing; the login page always maps onto
    // the site's real login URL (which requires `code=00`).
    if (page === "account" && s === "login") {
        return { type: "login" }
    }
    return { type: "unknown" }
}

// Route -> URL serializer, matching the existing rule34.xxx URL format. For
// postlist we omit empty tags and a zero pid so the home route serializes to
// exactly `?page=post&s=list`.
export function routeToUrl(route: Route): string {
    switch (route.type) {
        case "postlist": {
            let url = `${BASE}?page=post&s=list`
            if (route.tags) url += `&tags=${encodeURIComponent(route.tags)}`
            if (route.pid > 0) url += `&pid=${route.pid}`
            return url
        }
        case "postdetails":
            return `${BASE}?page=post&s=view&id=${route.id}`
        case "account":
            return "uname" in route
                ? `${BASE}?page=account&s=profile&uname=${encodeURIComponent(route.uname)}`
                : `${BASE}?page=account&s=profile&id=${route.id}`
        case "favorites":
            return `${BASE}?page=favorites&s=view&id=${route.id}`
        case "settings":
            return `${BASE}?page=account&s=options`
        case "login":
            return `${BASE}?page=account&s=login&code=00`
        case "unknown":
            // Never navigated to; a no-op fallback.
            return window.location.href
    }
}

// The bare site root (/) serves the post list; redirect it to the canonical
// PostList URL so the address bar reflects a real route. replaceState (not
// pushState) so this doesn't add a history entry.
if (window.location.pathname === "/" && window.location.search === "") {
    window.history.replaceState(null, "", routeToUrl({ type: "postlist", tags: undefined, pid: 0 }))
}

export const route = van.state<Route>(parseRoute(window.location.href))

// The route to return to after a successful login: a snapshot of the route we
// were on the moment we navigated *to* the login route. Null when we landed on
// the login page via a direct full-page load (no prior SPA route), in which
// case the login flow falls back to the post list. Lives here (not in the auth
// state) because it is captured inside `navigate` below.
export const returnTo = van.state<Route | null>(null)

// SPA navigation: push the new URL onto the history and update the route. The
// guard avoids pushing a redundant history entry when the URL is unchanged.
export function navigate(next: Route): void {
    const url = routeToUrl(next)
    if (url === window.location.pathname + window.location.search) return
    window.history.pushState(null, "", url)
    // Snapshot the current route when heading to login, so the login flow can
    // bring the user back here.
    if (next.type === "login") returnTo.val = route.val
    route.val = next
}

// Browser back/forward: the URL has already changed, just re-parse it.
window.addEventListener("popstate", () => {
    route.val = parseRoute(window.location.href)
})

import van from "vanjs-core/src/van"

import { Navbar } from "./Navbar"
import { PostDetails } from "./PostDetails"
import { PostList } from "./PostList"
import { type Route, route } from "./router"

const { div, h2, main, meta, p, span, style, title } = van.tags

const PLACEHOLDER_TITLES: Record<string, string> = {
    account: "Account",
    favorites: "Favorites",
    settings: "Settings",
}

// Echo the identifier a recognized route carries, so the placeholder shows the
// data the router parsed. An account may be addressed by id or username.
function placeholderParams(route: Route): string[] {
    if (route.type === "favorites") return [`id: ${route.id}`]
    if (route.type === "account") {
        return "uname" in route ? [`uname: ${route.uname}`] : [`id: ${route.id}`]
    }
    return []
}

// A stand-in for a route we recognize but haven't built yet. It echoes the
// data the router parsed so the routing side is fully exercised.
function RoutePlaceholder(route: Route) {
    const title = PLACEHOLDER_TITLES[route.type] ?? "Page"
    const params = placeholderParams(route)

    return div(
        { class: "flex flex-col items-center justify-center gap-3 py-24 text-center" },
        span({ class: "text-4xl" }, "🚧"),
        h2({ class: "text-lg font-medium text-zinc-200" }, title),
        p({ class: "text-sm text-zinc-500" }, "This page isn't built yet."),
        params.length > 0
            ? div(
                  {
                      class: "mt-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 font-mono text-xs text-zinc-400",
                  },
                  params.join("   "),
              )
            : null,
    )
}

function NotFound() {
    return div(
        { class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
        span({ class: "text-4xl" }, "🔍"),
        h2({ class: "text-lg font-medium text-zinc-200" }, "404 — page not found"),
        p({ class: "text-sm text-zinc-500" }, "This URL doesn't match any known page."),
    )
}

function ArueApp() {
    return div(
        { class: "flex min-h-screen flex-col bg-zinc-950 text-zinc-100" },
        Navbar(),
        main({ class: "mx-auto w-full max-w-[2000px] flex-1 px-4 py-6" }, () => {
            const r = route.val
            switch (r.type) {
                case "postlist":
                    return PostList()
                case "postdetails":
                    return PostDetails()
                case "account":
                case "favorites":
                case "settings":
                    return RoutePlaceholder(r)
                case "unknown":
                    return NotFound()
            }
        }),
    )
}

function ArueHead() {
    return [
        title("Rule34.xxx - Arueshalae"),
        style(TAILWIND_CSS),
        meta({ name: "viewport", content: "width=device-width, initial-scale=1.0" }),
    ]
}

export function initApp() {
    document.head.innerHTML = ""
    van.add(document.head, ArueHead())

    document.body.innerHTML = ""
    van.add(document.body, ArueApp())
}

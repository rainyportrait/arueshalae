import van from "vanjs-core"

import { CenteredState } from "./CenteredState"
import type { Route } from "./router"

const { div } = van.tags

const PLACEHOLDER_TITLES: Record<string, string> = {
    account: "Account",
    settings: "Settings",
}

// Echo the identifier a recognized route carries, so the placeholder shows the
// data the router parsed. An account may be addressed by id or username.
function placeholderParams(route: Route): string[] {
    if (route.type === "account") {
        return "uname" in route ? [`uname: ${route.uname}`] : [`id: ${route.id}`]
    }
    return []
}

// A stand-in for a route we recognize but haven't built yet. It echoes the
// data the router parsed so the routing side is fully exercised.
export function RoutePlaceholder(route: Route): HTMLDivElement {
    const params = placeholderParams(route)

    return CenteredState({
        icon: "🚧",
        title: PLACEHOLDER_TITLES[route.type] ?? "Page",
        message: "This page isn't built yet.",
        extra:
            params.length > 0
                ? div(
                      {
                          class: "mt-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 font-mono text-xs text-zinc-400",
                      },
                      params.join("   "),
                  )
                : undefined,
    })
}

export function NotFound() {
    return CenteredState({
        icon: "🔍",
        title: "404 — page not found",
        message: "This URL doesn't match any known page.",
    })
}

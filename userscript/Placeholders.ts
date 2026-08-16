import { CenteredState } from "./CenteredState"
import type { Route } from "./router"

const PLACEHOLDER_TITLES: Record<string, string> = {
    settings: "Settings",
}

// A stand-in for a route we recognize but haven't built yet.
export function RoutePlaceholder(route: Route): HTMLDivElement {
    return CenteredState({
        icon: "🚧",
        title: PLACEHOLDER_TITLES[route.type] ?? "Page",
        message: "This page isn't built yet.",
    })
}

export function NotFound() {
    return CenteredState({
        icon: "🔍",
        title: "404 — page not found",
        message: "This URL doesn't match any known page.",
    })
}

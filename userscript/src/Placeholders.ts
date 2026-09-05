import { CenteredState } from "./CenteredState.ts"

export function NotFound() {
    return CenteredState({
        icon: "🔍",
        title: "404 — page not found",
        message: "This URL doesn't match any known page.",
    })
}

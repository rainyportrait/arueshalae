import van from "vanjs-core"

import { PostGrid } from "./PostGrid.ts"
import type { Favorites } from "./api/favorites.ts"
import type { Route } from "./router.ts"
import {
    FAVORITES_PAGE_SIZE,
    favorites,
    favoritesCount,
    favoritesId,
    favoritesPid,
    reloadFavorites,
} from "./state/favorites.ts"

const { div } = van.tags

export function Favorites() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = favorites.val
        const count = favoritesCount.val
        // The page on screen: the ready page (the state keeps the previous one
        // while a new one loads, see state/load.ts). Pagination follows it, so
        // the old page's own number and links stay in place during the load.
        const source = state.status === "ready" ? state : null
        const grid = PostGrid({
            state,
            currentPage: Math.floor((source?.pid ?? favoritesPid.val) / FAVORITES_PAGE_SIZE) + 1,
            totalPages: source ? totalPages(source, count) : 1,
            routeForPage: (page): Route => ({
                type: "favorites",
                id: source?.id ?? favoritesId.val,
                pid: (page - 1) * FAVORITES_PAGE_SIZE,
                tags: source?.query,
                seed: source?.seed,
            }),
            empty: {
                icon: "🤍",
                title: "No favorites",
                message: "Posts you favorite will show up here.",
            },
            errorTitle: "Couldn't load favorites",
            onRetry: reloadFavorites,
        })
        if (!source?.hidden) return grid
        return div(
            { class: "flex flex-col gap-4" },
            div(
                {
                    class: "flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200",
                },
                `${source.hidden} ${source.hidden === 1 ? "result is" : "results are"} hidden because their media could not be retrieved.`,
                van.tags.button(
                    {
                        class: "shrink-0 font-medium underline underline-offset-2 hover:text-amber-100",
                        onclick: reloadFavorites,
                    },
                    "Try again",
                ),
            ),
            source.posts.length === 0
                ? div({ class: "py-12 text-center text-zinc-400" }, "No results could be loaded.")
                : grid,
        )
    })
}

// Prefer the profile's favorites count; fall back to the site's last-page
// link when the count is unavailable (0).
function totalPages(state: Favorites & { total?: number }, count: number): number {
    if ("total" in state && typeof state.total === "number")
        return Math.max(1, Math.ceil(state.total / FAVORITES_PAGE_SIZE))
    if (count > 0) return Math.max(1, Math.ceil(count / FAVORITES_PAGE_SIZE))
    return Math.max(1, Math.round(state.lastPagePID / FAVORITES_PAGE_SIZE) + 1)
}

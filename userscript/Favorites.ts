import van from "vanjs-core"

import { PostGrid } from "./PostGrid.ts"
import { routeToUrl } from "./router.ts"
import {
    FAVORITES_PAGE_SIZE,
    type FavoritesData,
    favorites,
    favoritesId,
    favoritesPid,
    reloadFavorites,
} from "./state/favorites.ts"

const { div } = van.tags

export function Favorites() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = favorites.val
        return PostGrid({
            state,
            currentPage: Math.floor(favoritesPid.val / FAVORITES_PAGE_SIZE) + 1,
            totalPages: state.status === "ready" ? totalPages(state) : 1,
            pageHref: (page) =>
                routeToUrl({
                    type: "favorites",
                    id: favoritesId.val,
                    pid: (page - 1) * FAVORITES_PAGE_SIZE,
                }),
            empty: {
                icon: "🤍",
                title: "No favorites",
                message: "Posts you favorite will show up here.",
            },
            errorTitle: "Couldn't load favorites",
            onRetry: reloadFavorites,
        })
    })
}

// Prefer the profile's favorites count; fall back to the site's last-page
// link when the count is unavailable (0).
function totalPages(state: FavoritesData): number {
    if (state.favoritesCount > 0)
        return Math.max(1, Math.ceil(state.favoritesCount / FAVORITES_PAGE_SIZE))
    return Math.max(1, Math.round(state.lastPagePID / FAVORITES_PAGE_SIZE) + 1)
}

import van from "vanjs-core"

import { PostGrid } from "./PostGrid.ts"
import { routeToUrl } from "./router.ts"
import {
    FAVORITES_PAGE_SIZE,
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
            totalPages:
                state.status === "ready"
                    ? Math.max(1, Math.round(state.lastPagePID / FAVORITES_PAGE_SIZE) + 1)
                    : 1,
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

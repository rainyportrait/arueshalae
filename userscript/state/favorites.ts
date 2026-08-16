import van from "vanjs-core"

import { type Favorites, fetchFavorites } from "../api/favorites.ts"
import { route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

// The favorites list is paginated 50 posts per page (pid = 50 * (page - 1)).
export const FAVORITES_PAGE_SIZE = 50

// Derived from the favorites route; zero on any other route.
export const favoritesId = van.derive<number>(() =>
    route.val.type === "favorites" ? route.val.id : 0,
)
export const favoritesPid = van.derive<number>(() =>
    route.val.type === "favorites" ? route.val.pid : 0,
)

export const favorites = van.state<Loadable<Favorites>>({ status: "loading" })

// Bumped to force a re-fetch (used by the error state's "Try again" button).
const reloadTick = van.state(0)

const loadFavorites = createLoader<Favorites, void>(favorites, () =>
    fetchFavorites(favoritesId.val, favoritesPid.val),
)

// Re-fetch whenever the route (id/pid) or reloadTick changes. Gated to
// favorites so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    if (route.val.type !== "favorites") return
    void reloadTick.val
    loadFavorites()
})

export function reloadFavorites(): void {
    reloadTick.val += 1
}

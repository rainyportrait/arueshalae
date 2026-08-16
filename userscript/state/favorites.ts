import van from "vanjs-core"

import { fetchUserProfile } from "../api/auth.ts"
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

// Favorites page data, enriched with the favorites count from the user's
// profile page. The site's own favorites paginator runs off a stale count
// (its "last page" can be empty), so the pagination is grounded in the
// profile's count instead. `0` means "count unavailable" and the UI falls
// back to the paginator's own last-page link.
export type FavoritesData = Favorites & { favoritesCount: number }

export const favorites = van.state<Loadable<FavoritesData>>({ status: "loading" })

// Bumped to force a re-fetch (used by the error state's "Try again" button).
const reloadTick = van.state(0)

// The profile fetch runs in parallel and is non-fatal: a failure just
// leaves the count at 0 and the UI falls back to the last-page link.
const loadFavorites = createLoader<FavoritesData, void>(favorites, async () => {
    const id = favoritesId.val
    const pid = favoritesPid.val
    const [page, profile] = await Promise.all([
        fetchFavorites(id, pid),
        fetchUserProfile(id).catch(() => null),
    ])
    return { ...page, favoritesCount: profile?.favorites ?? 0 }
})

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

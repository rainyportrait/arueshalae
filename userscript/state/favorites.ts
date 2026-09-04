import van from "vanjs-core"

import { fetchProfile } from "../api/auth.ts"
import { type Favorites, fetchFavorites } from "../api/favorites.ts"
import { route } from "../router.ts"
import { type Loadable, createLoader, routeLoader } from "./load.ts"

// The favorites list is paginated 50 posts per page (pid = 50 * (page - 1)).
export const FAVORITES_PAGE_SIZE = 50

// Derived from the favorites route; zero on any other route.
export const favoritesId = van.derive<number>(() =>
    route.val.type === "favorites" ? route.val.id : 0,
)
export const favoritesPid = van.derive<number>(() =>
    route.val.type === "favorites" ? route.val.pid : 0,
)

// The favorites page data (posts + the site's last-page offset) plus the
// route parameters it was loaded with, so pagination keeps working from the
// page on screen while the next one loads.
export type FavoritesReady = Favorites & { id: number; pid: number }

export const favorites = van.state<Loadable<FavoritesReady>>({ status: "loading" })

export const { pending: favoritesLoading, reload: reloadFavorites } = routeLoader<
    FavoritesReady,
    "favorites"
>(favorites, "favorites", (r) =>
    fetchFavorites(r.id, r.pid).then((result) => ({ ...result, id: r.id, pid: r.pid })),
)

// The favorites count from the user's profile page. The site's own favorites
// paginator runs off a stale count (its "last page" can be empty), so the
// pagination is grounded in the profile's count instead. Fetched only when
// the id changes, not on every page turn. `0` means "count unavailable"
// (loading, error, or not fetched) and the UI falls back to the paginator's
// own last-page link.
const favoritesCountLoadable = van.state<Loadable<{ count: number }>>({ status: "loading" })

// Non-fatal: a failure just leaves the count at 0 and the UI falls back to
// the last-page link. The loader's sequence counter drops out-of-order
// responses if the id changes mid-flight.
const { load: loadFavoritesCount } = createLoader<{ count: number }, number>(
    favoritesCountLoadable,
    (id: number) => fetchProfile({ id }).then((profile) => ({ count: profile.favorites })),
)

export const favoritesCount = van.derive<number>(() => {
    const c = favoritesCountLoadable.val
    return c.status === "ready" ? c.count : 0
})

// Fetch the profile when the id changes; off the favorites route the derived
// id is 0, which skips the fetch.
van.derive(() => {
    const id = favoritesId.val
    if (id === 0) return
    loadFavoritesCount(id)
})

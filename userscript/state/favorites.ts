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

// Favorites page data (posts + the site's last-page offset).
export const favorites = van.state<Loadable<Favorites>>({ status: "loading" })

// The favorites count from the user's profile page. The site's own favorites
// paginator runs off a stale count (its "last page" can be empty), so the
// pagination is grounded in the profile's count instead. Fetched only when
// the id changes, not on every page turn. `0` means "count unavailable" and
// the UI falls back to the paginator's own last-page link.
export const favoritesCount = van.state(0)

// Bumped to force a re-fetch (used by the error state's "Try again" button).
const reloadTick = van.state(0)

// Read rawVal (not val): this closure runs inside the trigger derive below,
// and a tracked read would make that derive depend on favoritesId/favoritesPid,
// re-running (and re-fetching) a second time when they change with the route.
const loadFavorites = createLoader<Favorites, void>(favorites, () => {
    const id = favoritesId.rawVal
    const pid = favoritesPid.rawVal
    return fetchFavorites(id, pid)
})

// Re-fetch the page whenever the route (id/pid) or reloadTick changes. Gated
// to favorites so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    if (route.val.type !== "favorites") return
    void reloadTick.val
    loadFavorites()
})

// Fetch the profile when the id changes; off the favorites route the derived
// id is 0, which skips the fetch. Non-fatal: a failure just leaves the count
// at 0 and the UI falls back to the last-page link. The sequence counter drops
// out-of-order responses if the id changes mid-flight.
let profileSeq = 0
van.derive(() => {
    const id = favoritesId.val
    if (id === 0) return
    const seq = ++profileSeq
    favoritesCount.val = 0
    void fetchUserProfile(id)
        .then((profile) => {
            if (seq === profileSeq) favoritesCount.val = profile.favorites
        })
        .catch(() => {
            if (seq === profileSeq) favoritesCount.val = 0
        })
})

export function reloadFavorites(): void {
    reloadTick.val += 1
}

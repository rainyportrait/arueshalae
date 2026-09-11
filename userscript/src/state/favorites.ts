import van from "vanjs-core"

import { fetchProfile } from "../api/auth.ts"
import { type Favorites, extractFavorites, fetchFavorites } from "../api/favorites.ts"
import type { Post } from "../api/post-list.ts"
import { searchFavoritePosts, serverBaseUrl } from "../api/server.ts"
import { route } from "../router.ts"
import { ensureFavoriteMedia } from "../sync/favorite-media.ts"
import { Rule34Reader } from "../sync/rule34.ts"
import { auth } from "./auth.ts"
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
export type FavoritesReady = Favorites & {
    id: number
    pid: number
    query?: string
    seed?: number
    total?: number
    hidden?: number
}

export const favorites = van.state<Loadable<FavoritesReady>>({ status: "loading" })

export const { pending: favoritesLoading, reload: reloadFavorites } = routeLoader<
    FavoritesReady,
    "favorites"
>(
    favorites,
    "favorites",
    (r) => {
        const a = auth.rawVal
        return r.tags !== undefined && a.status === "authenticated" && r.id === a.userId
            ? fetchSearchedFavorites(r.id, r.tags, r.pid, r.seed)
            : fetchFavorites(r.id, r.pid).then((result) => ({
                  ...result,
                  id: r.id,
                  pid: r.pid,
                  hidden: 0,
              }))
    },
    // The initial route is a favorites page: the live document is that page.
    // `null` when the document carries no list container (an error page),
    // in which case the page loads from the network.
    (r) =>
        r.tags === undefined && document.querySelector(".image-list")
            ? { ...extractFavorites(document, r.pid), id: r.id, pid: r.pid, hidden: 0 }
            : null,
)

export async function fetchSearchedFavorites(
    userId: number,
    query: string,
    pid: number,
    seed?: number,
): Promise<FavoritesReady> {
    const failed = new Set<number>()
    const reader = new Rule34Reader(userId, false)

    for (;;) {
        const result = await searchFavoritePosts(query, pid, seed)
        const missing = result.posts.filter((post) => !post.downloaded && !failed.has(post.postId))
        if (missing.length === 0) {
            const posts: Post[] = result.posts
                .filter((post) => post.downloaded && !failed.has(post.postId))
                .map((post) => ({
                    id: post.postId,
                    link: `/index.php?page=post&s=view&id=${post.postId}`,
                    thumbnail: `${serverBaseUrl()}/api/posts/${post.postId}/media?type=mini`,
                    tags: post.tags,
                }))
            return {
                posts,
                lastPagePID: Math.max(
                    0,
                    (Math.ceil(result.total / FAVORITES_PAGE_SIZE) - 1) * FAVORITES_PAGE_SIZE,
                ),
                id: userId,
                pid,
                query,
                seed,
                total: result.total,
                hidden: result.posts.filter((post) => failed.has(post.postId)).length,
            }
        }

        const outcomes = await Promise.allSettled(
            missing.map((post) => ensureFavoriteMedia(reader, post.postId)),
        )
        for (let index = 0; index < outcomes.length; index += 1) {
            const outcome = outcomes[index]
            if (outcome.status === "rejected") failed.add(missing[index].postId)
        }
        // Successful downloads and deletions both change the local result set;
        // rerun it before publishing. Failed IDs remain hidden for this load.
    }
}

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

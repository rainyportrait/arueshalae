import { type PostDetails, fetchPostDetails } from "../api/post-details.ts"

// Session-lifetime cache of fetched post details, shared by the details page
// and the gallery's neighbor prefetch. A post's media never changes, so an
// entry stays valid for the whole session; only the score drifts (it
// refreshes when the tab is reloaded). In-flight fetches are deduplicated by
// id, so a prefetch and a navigation racing each other issue one request.
const cache = new Map<number, PostDetails>()
const inflight = new Map<number, Promise<PostDetails>>()

// Store a post recovered from the server's initial rendering (which the app
// parses instead of fetching) so the cache treats it like any fetched entry:
// a gallery step back to it and the neighbor prefetch find it cached.
export function primePostDetails(id: number, post: PostDetails): void {
    cache.set(id, post)
}

export function cachedPostDetails(id: number): Promise<PostDetails> {
    const hit = cache.get(id)
    if (hit !== undefined) return Promise.resolve(hit)
    const pending = inflight.get(id)
    if (pending !== undefined) return pending
    const fetch = fetchPostDetails(id).then(
        (post) => {
            inflight.delete(id)
            cache.set(id, post)
            return post
        },
        (error: unknown) => {
            inflight.delete(id)
            throw error
        },
    )
    inflight.set(id, fetch)
    return fetch
}

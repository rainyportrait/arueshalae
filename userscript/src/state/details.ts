import van from "vanjs-core"

import { type PostDetails, extractPostDetails } from "../api/post-details.ts"
import { type PostOrigin } from "../router.ts"
import { type Loadable, routeLoader } from "./load.ts"
import { cachedPostDetails, primePostDetails } from "./post-details-cache.ts"

// The origin is stored in the ready payload (it rode on the URL when the post
// was opened) so the details page has no dependency on the route and stays
// frozen while another page loads.
export type DetailsState = Loadable<{ post: PostDetails; origin: PostOrigin | undefined }>

export const details = van.state<DetailsState>({ status: "loading" })

// Load whenever the postdetails route changes. Every load — including cache
// hits — goes through the loader: the sequence bump it performs discards
// in-flight fetches for older posts, so a late response can never clobber a
// newer (possibly cached) page. A cache hit settles a microtask later, and
// the state keeps the previous post until then, so no skeleton flashes.
export const { pending: detailsLoading, reload: reloadDetails } = routeLoader<
    { post: PostDetails; origin: PostOrigin | undefined },
    "postdetails"
>(
    details,
    "postdetails",
    (r) => cachedPostDetails(r.id).then((post) => ({ post, origin: r.origin })),
    // The initial route is a post view: the live document is that exact page.
    // Prime the cache with it, as if the fetch had settled. `null` when the
    // document carries no post media (an error page, e.g. a deleted post),
    // in which case the page loads from the network.
    (r) => {
        if (!document.querySelector("img#image, video#gelcomVideoPlayer")) return null
        const post = extractPostDetails(document, r.id)
        primePostDetails(r.id, post)
        return { post, origin: r.origin }
    },
)

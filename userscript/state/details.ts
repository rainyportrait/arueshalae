import van from "vanjs-core"

import { type PostDetails } from "../api/post-details.ts"
import { type PostOrigin } from "../router.ts"
import { type Loadable, routeLoader } from "./load.ts"
import { cachedPostDetails } from "./post-details-cache.ts"

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
>(details, "postdetails", (r) =>
    cachedPostDetails(r.id).then((post) => ({ post, origin: r.origin })),
)

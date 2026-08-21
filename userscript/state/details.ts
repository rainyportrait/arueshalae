import van from "vanjs-core"

import { type PostDetails } from "../api/post-details.ts"
import { type PostOrigin, route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"
import { cachedPostDetails } from "./post-details-cache.ts"

// The origin is stored in the ready payload (it rode on the URL when the post
// was opened) so the details page has no dependency on the route and stays
// frozen while another page loads.
export type DetailsState = Loadable<{ post: PostDetails; origin: PostOrigin | undefined }>

export const details = van.state<DetailsState>({ status: "loading" })

// Bumped to force a details re-fetch (used by the error state's "Try again").
const detailsTick = van.state(0)

const { load: loadDetails, pending: detailsLoading } = createLoader(
    details,
    ({ id, origin }: { id: number; origin: PostOrigin | undefined }) =>
        cachedPostDetails(id).then((post) => ({ post, origin })),
)

export { detailsLoading }

// Load whenever the postdetails route or detailsTick changes. Gated to
// postdetails so we don't fire a wasted fetch while sitting on another route.
// Every load — including cache hits — goes through the loader: the sequence
// bump it performs discards in-flight fetches for older posts, so a late
// response can never clobber a newer (possibly cached) page. A cache hit
// settles a microtask later, and the state keeps the previous post until
// then, so no skeleton flashes.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails") return
    void detailsTick.val
    loadDetails({ id: r.id, origin: r.origin })
})

export function reloadDetails(): void {
    detailsTick.val += 1
}

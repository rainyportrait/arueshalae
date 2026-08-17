import van from "vanjs-core"

import { type PostDetails } from "../api/post-details.ts"
import { route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"
import { cachedPostDetails, peekPostDetails } from "./post-details-cache.ts"

export type DetailsState = Loadable<{ post: PostDetails }>

export const details = van.state<DetailsState>({ status: "loading" })

// Bumped to force a details re-fetch (used by the error state's "Try again").
const detailsTick = van.state(0)

const loadDetails = createLoader(details, (id: number) =>
    cachedPostDetails(id).then((post) => ({ post })),
)

// Load whenever the postdetails route or detailsTick changes. Gated to
// postdetails so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails") return
    void detailsTick.val
    // A cached post (gallery steps, revisits) resolves synchronously: set the
    // ready state directly so the loading skeleton doesn't flash.
    const cached = peekPostDetails(r.id)
    if (cached !== undefined) {
        details.val = { status: "ready", post: cached }
        return
    }
    loadDetails(r.id)
})

export function reloadDetails(): void {
    detailsTick.val += 1
}

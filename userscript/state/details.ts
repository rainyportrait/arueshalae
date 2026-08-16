import van from "vanjs-core"

import { type PostDetails, fetchPostDetails } from "../api/post-details.ts"
import { route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

export type DetailsState = Loadable<{ post: PostDetails }>

export const details = van.state<DetailsState>({ status: "loading" })

// Bumped to force a details re-fetch (used by the error state's "Try again").
const detailsTick = van.state(0)

const loadDetails = createLoader(details, (id: number) =>
    fetchPostDetails(id).then((post) => ({ post })),
)

// Re-fetch whenever the postdetails route or detailsTick changes. Gated to
// postdetails so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails") return
    void detailsTick.val
    loadDetails(r.id)
})

export function reloadDetails(): void {
    detailsTick.val += 1
}

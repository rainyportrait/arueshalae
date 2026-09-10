import van from "vanjs-core"

import { type PostDetails, extractPostDetails } from "../api/post-details.ts"
import { fetchCachedPostDetails } from "../api/server.ts"
import { isChallengePage } from "../captcha.ts"
import { type PostOrigin } from "../router.ts"
import { route } from "../router.ts"
import { type Loadable, errorMessage } from "./load.ts"
import { cachedPostDetails, primePostDetails } from "./post-details-cache.ts"
import { serverSettings } from "./settings.ts"

// The origin is stored in the ready payload (it rode on the URL when the post
// was opened) so the details page has no dependency on the route and stays
// frozen while another page loads.
export type DetailsState = Loadable<{ post: PostDetails; origin: PostOrigin | undefined }>

export const details = van.state<DetailsState>({ status: "loading" })

// Load whenever the postdetails route changes. Rule34 remains authoritative,
// but an enabled server may publish its smaller cached representation first.
// The sequence discards both kinds of late response after navigation, and a
// late server response never replaces an already-published Rule34 response.
export const detailsLoading = van.state(false)
const reloadTick = van.state(0)
let sequence = 0
let firstEvaluation = true

van.derive(() => {
    const isFirst = firstEvaluation
    firstEvaluation = false
    const current = route.val
    if (current.type !== "postdetails") {
        sequence += 1
        detailsLoading.val = false
        return
    }
    reloadTick.val

    if (
        isFirst &&
        !isChallengePage() &&
        document.querySelector("img#image, video#gelcomVideoPlayer")
    ) {
        const post = extractPostDetails(document, current.id)
        primePostDetails(current.id, post)
        details.val = { status: "ready", post, origin: current.origin }
        return
    }

    const ownSequence = ++sequence
    let cachedPublished = false
    let upstreamPublished = false
    detailsLoading.val = true

    if (serverSettings.rawVal.enabled && serverSettings.rawVal.useCachedPostDetails !== false) {
        void fetchCachedPostDetails(current.id).then(
            (post) => {
                if (ownSequence !== sequence || upstreamPublished) return
                cachedPublished = true
                details.val = { status: "ready", post, origin: current.origin }
            },
            () => {},
        )
    }

    void cachedPostDetails(current.id).then(
        (post) => {
            if (ownSequence !== sequence) return
            upstreamPublished = true
            detailsLoading.val = false
            details.val = { status: "ready", post, origin: current.origin }
        },
        (error: unknown) => {
            if (ownSequence !== sequence) return
            detailsLoading.val = false
            if (!cachedPublished) details.val = { status: "error", error: errorMessage(error) }
        },
    )
})

export function reloadDetails(): void {
    reloadTick.val += 1
}

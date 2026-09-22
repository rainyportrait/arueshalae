import van from "vanjs-core"

import { type PostDetails, extractPostDetails } from "../api/post-details.ts"
import { fetchCachedPostDetails } from "../api/server.ts"
import { isChallengePage } from "../captcha.ts"
import { type MediaSlot, buildMediaSlot, discardMediaSlot } from "../media-element.ts"
import { type PostOrigin } from "../router.ts"
import { route } from "../router.ts"
import { galleryFocus } from "./gallery.ts"
import { type Loadable, errorMessage } from "./load.ts"
import { cachedPostDetails, primePostDetails } from "./post-details-cache.ts"
import { serverSettings } from "./settings.ts"

// The origin is stored in the ready payload (it rode on the URL when the post
// was opened) so the details page has no dependency on the route and stays
// frozen while another page loads.
export type DetailsState = Loadable<{ post: PostDetails; origin: PostOrigin | undefined }>

export const details = van.state<DetailsState>({ status: "loading" })

// The media element of the payload being loaded (built when the fetch
// settles, see publishWhenMediaIsReady). The details page adopts it instead
// of building its own element, so the media is decoded by the time the page
// may show it. Payloads published without a load (the document seed) have
// none, and the page builds the element on the spot.
export const detailsMedia = van.state<MediaSlot | undefined>(undefined)

// True from a load's start until its payload AND its media are ready (or the
// fetch fails). The payload alone isn't enough to swap the screen: the media
// is the page, so it loads (detached) while the previous post is still on
// screen, and only its readiness — checked in the payload's whenReady —
// clears this. The loading bar and the screen swap (App.ts) both read it.
export const detailsLoading = van.state(false)

// Load whenever the postdetails route changes. Rule34 remains authoritative,
// but an enabled server may publish its smaller cached representation first.
// The sequence discards both kinds of late response after navigation, and a
// late server response never replaces an already-published Rule34 response.
const reloadTick = van.state(0)
let sequence = 0
let firstEvaluation = true

van.derive(() => {
    const isFirst = firstEvaluation
    firstEvaluation = false
    const current = route.val
    if (current.type !== "postdetails") {
        sequence += 1
        // A pending slot never published: stop its element (a still-loading
        // hidden video). A published one is adopted by the page, which is
        // being torn down or kept for the old screen in the same pass.
        const pending = detailsMedia.rawVal
        if (pending !== undefined) discardMediaSlot(pending)
        detailsMedia.val = undefined
        detailsLoading.val = false
        return
    }
    reloadTick.val

    if (
        isFirst &&
        !isChallengePage() &&
        document.querySelector("img#image, video#gelcomVideoPlayer")
    ) {
        // The seed publishes without a media slot: this payload is the
        // document the browser already rendered, and the app holds no
        // previous page here, so nothing gates it. The details page builds
        // the element on the spot for such slotless payloads.
        const post = extractPostDetails(document, current.id)
        primePostDetails(current.id, post)
        details.val = { status: "ready", post, origin: current.origin }
        return
    }

    const ownSequence = ++sequence
    let cachedPublished = false
    let cachedPending = false
    let upstreamPublished = false
    detailsLoading.val = true

    if (serverSettings.rawVal.enabled && serverSettings.rawVal.useCachedPostDetails !== false) {
        void fetchCachedPostDetails(current.id).then(
            (post) => {
                if (ownSequence !== sequence || upstreamPublished) return
                cachedPending = true
                publishWhenMediaIsReady(post, current.origin, ownSequence, () => {
                    cachedPending = false
                    cachedPublished = true
                })
            },
            () => {},
        )
    }

    void cachedPostDetails(current.id).then(
        (post) => {
            if (ownSequence !== sequence) return
            upstreamPublished = true
            cachedPending = false
            publishWhenMediaIsReady(post, current.origin, ownSequence)
        },
        (error: unknown) => {
            if (ownSequence !== sequence) return
            // The server copy may have arrived but still be decoding. Let it
            // publish when ready instead of replacing it with an error.
            if (cachedPending) return
            detailsLoading.val = false
            if (!cachedPublished) {
                // The cache slot (if built) never published: stop it, and drop
                // it so its pending whenReady can't publish after the error.
                const pending = detailsMedia.rawVal
                if (pending !== undefined) discardMediaSlot(pending)
                detailsMedia.val = undefined
                details.val = { status: "error", error: errorMessage(error) }
            }
        },
    )
})

// Build the payload's media element now — detached, so it loads while the
// previous page is still on screen — and publish the payload only once the
// element is ready. detailsMedia moves first so the page that adopts the
// element finds it; a superseded slot's late readiness must not publish or
// clear a newer load's detailsLoading.
function publishWhenMediaIsReady(
    post: PostDetails,
    origin: PostOrigin | undefined,
    ownSequence: number,
    onPublish?: () => void,
): void {
    const previous = detailsMedia.rawVal
    // An upgrade of the post already on screen (the server's cached copy to
    // the upstream one) keeps the user's "original image" toggle.
    const slot = buildMediaSlot(
        post,
        galleryFocus.rawVal,
        previous !== undefined && previous.post.id === post.id
            ? previous.showOriginal.val
            : undefined,
    )
    // A superseded video may never fire canplay/error, so its readiness
    // callback cannot be relied on to remove it from the hidden preloader.
    if (previous !== undefined) discardMediaSlot(previous)
    detailsMedia.val = slot
    void slot.whenReady.then(() => {
        if (ownSequence !== sequence || detailsMedia.rawVal !== slot) {
            // A newer load superseded this one before it was ready: it never
            // published, so its element is parked/detached — stop it.
            discardMediaSlot(slot)
            return
        }
        onPublish?.()
        details.val = { status: "ready", post, origin }
        detailsLoading.val = false
    })
}

export function reloadDetails(): void {
    reloadTick.val += 1
}

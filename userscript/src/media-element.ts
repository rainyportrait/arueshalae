import van from "vanjs-core"
import type { State } from "vanjs-core"

import type { PostDetails as PostDetailsData } from "./api/post-details.ts"
import clsx from "./clsx.ts"
import { imageUrl, videoPosterUrl, videoUrl } from "./media-source.ts"
import { preferOriginal } from "./state/settings.ts"

const { img, video } = van.tags

// The media element of a details payload, built BEFORE the payload is
// published so the media loads while the previous page is still on screen.
// Images stay detached (decode() works off the document); a video can't start
// loading while detached, so it is parked in a hidden container and the page
// moves it into the holder on adoption. `whenReady` resolves when the element
// can be shown: images via decode(), videos when playback can start (the
// poster frame shows until then). The per-post "original image" toggle state
// lives here, seeded from the setting (or from the previous slot of the same
// post), and the element's src stays a live prop on it, so the toggle keeps
// working after the element is inserted.
export type MediaSlot = {
    post: PostDetailsData
    el: HTMLElement
    showOriginal: State<boolean>
    whenReady: Promise<void>
}

// Hidden home of the video elements waiting to be adopted: in a document
// (display:none doesn't stop the media load algorithm, so they load and
// buffer) but taking no space and painting nothing until adoption.
let preloader: HTMLDivElement | undefined
function park(el: HTMLElement): void {
    preloader ??= (() => {
        const div = document.createElement("div")
        div.style.display = "none"
        document.body.append(div)
        return div
    })()
    preloader.append(el)
}

// Drop a slot that never made it on screen (superseded, or its load errored):
// its element is parked (a still-loading hidden video) or detached (an image),
// and removing it stops the load.
export function discardMediaSlot(slot: MediaSlot): void {
    if (slot.el.parentElement === preloader) slot.el.remove()
}

// The media element's classes: capped to the viewport normally, or filling
// the container (and object-contain scaled) in focus mode.
export function mediaElementClass(fill: boolean): string {
    // min-h-0 overrides the grid item's automatic minimum size: without it
    // the image's natural height sizes the (auto) grid row, and max-h-full
    // then resolves against that inflated track instead of the viewport.
    return clsx(
        fill ? "h-full object-contain" : "max-h-[80vh]",
        // pan-y lets the page see horizontal swipes (gallery navigation) while
        // the browser keeps handling vertical page scroll from the media.
        "w-auto max-w-full touch-pan-y rounded-lg transition-opacity duration-200",
    )
}

export function buildMediaSlot(
    post: PostDetailsData,
    fill: boolean,
    showOriginal = preferOriginal.val,
): MediaSlot {
    const media = post.media
    const toggle = van.state(showOriginal)
    const elementClass = mediaElementClass(fill)
    if (media.kind === "video") {
        const el = video({
            src: () => videoUrl(post.id, media),
            poster: () => videoPosterUrl(post.id, media),
            controls: true,
            loop: true,
            muted: true,
            autoplay: true,
            // Without playsinline, mobile Safari autoplays videos in its
            // native fullscreen player instead of inline.
            playsinline: true,
            class: elementClass,
            style: "grid-area: 1 / 1",
            onerror: (e: Event) => {
                const video = e.currentTarget as HTMLVideoElement
                if (video.getAttribute("src") !== media.src) video.src = media.src
                if (video.getAttribute("poster") !== media.poster) video.poster = media.poster
            },
        })
        park(el)
        const whenReady = new Promise<void>((resolve) => {
            if (el.readyState >= 2) resolve()
            else {
                el.addEventListener("canplay", () => resolve(), { once: true })
                el.addEventListener("error", () => resolve(), { once: true })
            }
        })
        return { post, el, showOriginal: toggle, whenReady }
    }
    const el = img({
        // Function prop: re-runs when the toggle changes, swapping the
        // displayed image for the original (and back).
        src: () => imageUrl(post.id, media, toggle.val),
        alt: post.title ? `Post ${post.id}: ${post.title}` : `Post ${post.id}`,
        class: elementClass,
        style: "grid-area: 1 / 1",
        onerror: (e: Event) => {
            const image = e.currentTarget as HTMLImageElement
            const upstream = toggle.val && media.originalImage ? media.originalImage : media.src
            if (image.getAttribute("src") !== upstream) image.src = upstream
        },
    })
    // A rejected decode (broken image) still resolves: show whatever the
    // browser renders rather than holding the previous post forever.
    return { post, el, showOriginal: toggle, whenReady: el.decode().catch(() => {}) }
}

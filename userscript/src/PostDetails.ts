import van from "vanjs-core"
import type { ChildDom, State } from "vanjs-core"

import { CenteredState } from "./CenteredState.ts"
import { Link } from "./Link.ts"
import { TagList, TagListSkeleton } from "./TagList.ts"
import { Toggle } from "./Toggle.ts"
import type { PostDetails as PostDetailsData } from "./api/post-details.ts"
import type { Post } from "./api/post-list.ts"
import { isAnimated } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { imageUrl, thumbnailUrl, videoPosterUrl, videoUrl } from "./media-source.ts"
import { type PostOrigin, postHref, route } from "./router.ts"
import { auth } from "./state/auth.ts"
import { details, reloadDetails } from "./state/details.ts"
import {
    type FavoriteStatus,
    addFavoriteWithStatus,
    membershipWrites,
    removeFavoriteWithStatus,
    retryFavoriteMembership,
    retryUnfavoriteMembership,
} from "./state/favorite-action.ts"
import { loadedPosts, originKey } from "./state/gallery-collection.ts"
import { canStep, gallery, galleryFocus, reloadGallery, step } from "./state/gallery.ts"
import { libraryPosts } from "./state/library.ts"
import { preferOriginal, serverSettings } from "./state/settings.ts"

const { a, aside, button, div, h4, img, span, video } = van.tags

function StatsSection({ post }: { post: PostDetailsData }) {
    const cells: ChildDom[] = []
    const push = (label: string, value: ChildDom) => {
        cells.push(
            span({ class: "text-zinc-500" }, label),
            div({ class: "min-w-0 text-right" }, value),
        )
    }
    push("Id", span({ class: "tabular-nums" }, `#${post.id}`))
    if (post.title) push("Title", span({ class: "wrap-break-word" }, post.title))
    if (post.posted) push("Posted", span({ class: "truncate" }, post.posted))
    if (post.poster)
        push(
            "by",
            Link(
                {
                    href: post.posterHref,
                    class: "truncate text-rose-300 hover:text-rose-200",
                },
                post.poster,
            ),
        )
    if (post.media.width && post.media.height)
        push("Size", span({}, `${post.media.width} × ${post.media.height}`))
    if (post.sourceHref)
        push(
            "Source",
            a(
                {
                    href: post.sourceHref,
                    target: "_blank",
                    rel: "noopener noreferrer",
                    class: "break-all text-cyan-300 hover:text-cyan-200",
                    title: post.source,
                },
                post.source,
            ),
        )
    if (post.rating) push("Rating", span({}, post.rating))
    push("Score", span({ class: "tabular-nums" }, String(post.score)))

    return div(
        { class: "flex flex-col gap-1" },
        h4(
            {
                class: clsx(
                    "px-1.5 pb-0.5 text-xs font-semibold tracking-wider text-zinc-500 uppercase",
                ),
            },
            "Metadata",
        ),
        div({ class: "grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 px-1.5 text-sm" }, cells),
    )
}

// The displayed image can be swapped for the full-size file from the
// "Original image" sidebar link. Image posts only, and hidden when the
// displayed image is already the original (small images don't get a sample,
// so the two URLs are identical). Reuses the settings page's toggle so both
// image-quality switches look alike.
function OriginalImageToggle({
    post,
    showOriginal,
}: {
    post: PostDetailsData
    showOriginal: State<boolean>
}) {
    const media = post.media
    if (media.kind !== "image" || !media.originalImage || media.originalImage === media.src)
        return null
    return div(
        { class: "rounded-xl border border-zinc-800 bg-zinc-900/40 p-4" },
        Toggle({
            label: "Original image",
            description: "Show the full-resolution image instead of the sample.",
            state: showOriginal,
            onToggle: (value) => (showOriginal.val = value),
        }),
    )
}

// The favorites toggle. Rule34 exposes no way to ask whether a post is in
// the user's favorites, so without the arueshalae server the button always
// starts out "Add to favorites" and only becomes the "Remove from
// favorites" face after the user added the post (the API's ack settles
// "added"). With the server enabled, its membership record supplies the
// initial face. Downloaded media has independent status, and a failed local
// membership update retries without repeating the upstream mutation.
function AddFavoriteButton({
    post,
    favorite,
    isCurrent,
}: {
    post: PostDetailsData
    favorite: State<FavoriteStatus>
    isCurrent: () => boolean
}) {
    return () => {
        if (auth.val.status !== "authenticated") return document.createComment("")
        const base =
            favorite.val === "idle" &&
            serverSettings.val.enabled &&
            libraryPosts.val.get(post.id)?.membership === "favorited"
                ? "already"
                : favorite.val
        // A save in flight (started by this or an earlier mount of the post)
        // shows as "saving" even on a fresh mount, where the per-post state
        // has reset to "idle".
        const state = membershipWrites.val.has(post.id) ? "saving" : base
        // The "added"/"already" faces double as the "Remove from favorites"
        // face: the button is a toggle, and both mean "the post is in the
        // user's favorites".
        return button(
            {
                type: "button",
                // The two failed faces stay clickable: they retry the server
                // part alone (rule34 already holds the favorite, or already
                // dropped it).
                disabled:
                    state !== "idle" &&
                    state !== "added" &&
                    state !== "already" &&
                    state !== "library-failed" &&
                    state !== "removal-failed",
                class: clsx(
                    "w-full rounded-lg border px-3 py-2 text-sm transition-colors",
                    state === "idle" || state === "added" || state === "already"
                        ? "cursor-pointer border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800"
                        : state === "library-failed" || state === "removal-failed"
                          ? "cursor-pointer border-rose-900/70 bg-rose-950/30 text-rose-300 hover:bg-rose-950/50"
                          : "cursor-default border-zinc-800 bg-zinc-900/40 text-zinc-500",
                ),
                title: favoriteButtonTitle(state),
                // The computed state (not the raw favorite.val) drives
                // add/remove — that's what makes the "already" overlay work,
                // where the raw state is still "idle".
                onclick: () => {
                    if (membershipWrites.val.has(post.id)) return
                    if (favorite.val === "library-failed")
                        void retryFavoriteMembership(post, favorite, isCurrent)
                    else if (favorite.val === "removal-failed")
                        void retryUnfavoriteMembership(post, favorite, isCurrent)
                    else if (state === "added" || state === "already")
                        void removeFavoriteWithStatus(post, favorite, isCurrent)
                    else if (state === "idle") void addFavoriteWithStatus(post, favorite, isCurrent)
                },
            },
            favoriteButtonLabel(state),
        )
    }
}

function favoriteButtonLabel(state: FavoriteStatus): string {
    switch (state) {
        case "adding":
            return "Adding…"
        case "saving":
            return "Updating library…"
        case "removing":
            return "Removing…"
        case "added":
        case "already":
            return "Remove from favorites"
        case "library-failed":
        case "removal-failed":
            return "Library update failed"
        case "stale-session":
            return "Session expired"
        case "idle":
            return "Add to favorites"
    }
}

function favoriteButtonTitle(state: FavoriteStatus): string {
    switch (state) {
        case "library-failed":
            return [
                "The favorite was added on rule34.xxx, but updating local membership failed.",
                "Click to retry.",
            ].join(" ")
        case "removal-failed":
            return [
                "The favorite was removed on rule34.xxx, but updating local membership failed.",
                "Click to retry.",
            ].join(" ")
        case "stale-session":
            return [
                "Your rule34 session has expired, so the removal failed.",
                "The post is still in your favorites — log in again to manage it.",
            ].join(" ")
        default:
            return ""
    }
}

function Sidebar({
    post,
    showOriginal,
    favorite,
    isCurrent,
}: {
    post: PostDetailsData
    showOriginal: State<boolean>
    favorite: State<FavoriteStatus>
    isCurrent: () => boolean
}) {
    return div(
        { class: "flex flex-col gap-6" },
        AddFavoriteButton({ post, favorite, isCurrent }),
        LibraryDownloadStatus(post.id),
        OriginalImageToggle({ post, showOriginal }),
        StatsSection({ post }),
        TagList({ tags: post.tags }),
    )
}

function LibraryDownloadStatus(postId: number) {
    return () => {
        if (!serverSettings.val.enabled) return document.createComment("")

        return div(
            { class: "text-sm text-zinc-400" },
            libraryPosts.val.get(postId)?.downloadState ?? "Local status unknown",
        )
    }
}

// Build the media element for a post without inserting it. The element
// starts transparent; `whenReady` resolves when it can be faded in — images
// via decode(), videos when playback can start (the poster frame shows until
// then). The img src stays a live prop so the "original image" toggle keeps
// working after insertion.
// The media element's classes: capped to the viewport normally, or filling
// the container (and object-contain scaled) in focus mode.
function mediaElementClass(fill: boolean): string {
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

function buildMediaEl(
    post: PostDetailsData,
    showOriginal: State<boolean>,
    // In focus mode the media box fills its container (flex-1) and the
    // content is object-contain scaled to the largest size that fits in it.
    fill: boolean,
): { el: HTMLElement; whenReady: Promise<void>; fill: boolean } {
    const media = post.media
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
        const whenReady = new Promise<void>((resolve) => {
            if (el.readyState >= 2) resolve()
            else {
                el.addEventListener("canplay", () => resolve(), { once: true })
                el.addEventListener("error", () => resolve(), { once: true })
            }
        })
        return { el, whenReady, fill }
    }
    const el = img({
        // Function prop: re-runs when showOriginal changes, swapping the
        // displayed image for the original (and back).
        src: () => imageUrl(post.id, media, showOriginal.val),
        alt: post.title ? `Post ${post.id}: ${post.title}` : `Post ${post.id}`,
        class: elementClass,
        style: "grid-area: 1 / 1",
        onerror: (e: Event) => {
            const image = e.currentTarget as HTMLImageElement
            const upstream =
                showOriginal.val && media.originalImage ? media.originalImage : media.src
            if (image.getAttribute("src") !== upstream) image.src = upstream
        },
    })
    // A rejected decode (broken image) still resolves: fade in whatever the
    // browser renders rather than holding the old post forever.
    return {
        el,
        whenReady: el.decode().catch(() => {}),
        fill,
    }
}

// One side of the gallery: a live node returning a chevron button. Disabled
// (and inert) when there is no post in that direction. canStep() reads the
// live collection, which is not van state, so a page settling under an
// unchanged route (the post search, a boundary publish) would leave
// `enabled` stale: reading the published snapshot registers `gallery` as a
// dependency, re-evaluating the button whenever the loaded pages change.
function GalleryArrow({ dir }: { dir: 1 | -1 }) {
    return () => {
        void gallery.val
        const enabled = canStep(dir)
        return button(
            {
                type: "button",
                class: clsx(
                    "pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-zinc-700",
                    "bg-zinc-900/80 text-lg text-zinc-200 backdrop-blur transition-colors",
                    enabled ? "cursor-pointer hover:bg-zinc-800" : "cursor-default opacity-30",
                ),
                title: dir === 1 ? "Next post (→)" : "Previous post (←)",
                onclick: () => {
                    if (enabled) step(dir)
                },
            },
            span({ "icon-name": dir === 1 ? "chevron-right" : "chevron-left" }),
        )
    }
}

// Toggles focus mode: hides the app navbar and the post's metadata sidebar so
// the gallery fills the screen. Lives in the filmstrip header (the part of the
// gallery that stays visible in focus mode) so the user can always exit.
function FocusButton() {
    return button(
        {
            type: "button",
            class: () =>
                clsx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                    galleryFocus.val
                        ? "border-zinc-500 bg-zinc-700 text-zinc-100"
                        : "border-zinc-800 text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-200",
                ),
            title: () =>
                galleryFocus.val ? "Exit focus mode (Esc)" : "Focus mode: hide navigation (F)",
            onclick: () => {
                galleryFocus.val = !galleryFocus.val
            },
        },
        () =>
            span({
                "icon-name": galleryFocus.val ? "minimize" : "maximize",
                class: "text-sm",
            }),
    )
}

// The gallery filmstrip: the collection's loaded posts as thumbnails, with a
// position counter. The strip grows as boundary steps load more pages.
// In focus mode it runs vertically down the right side of the screen and
// scrolls instead of growing beyond the viewport.
//
// The returned node is built ONCE and kept across gallery steps (the caller
// memoizes it): every part that varies is a live binding inside, so stepping
// posts never swaps the scroll container — a swap would reset its scroll
// position. Only a change of the loaded pages rebuilds the thumbs.
function Filmstrip({
    origin,
    activeId,
    vertical = false,
}: {
    origin: PostOrigin
    activeId: () => number
    vertical?: boolean
}) {
    // The active post's index over the currently loaded pages (-1 if absent).
    const activeIndex = () => {
        const g = gallery.val
        if (g.status !== "ready") return -1
        return loadedPosts(g).findIndex((entry) => entry.post.id === activeId())
    }
    // The position counter. A live node: passed to the header as a function
    // (never called) so vanjs wraps it in a binding — re-running on post
    // steps and page loads. A called Counter() would run once at build time
    // (while the gallery is still loading) and never update again. Swapping
    // a tiny span is fine (only the scroller must not be swapped).
    const Counter = () => {
        const g = gallery.val
        const index = activeIndex()
        const total = g.status === "ready" ? loadedPosts(g).length : 0
        return index === -1
            ? document.createComment("")
            : span({ class: "text-xs text-zinc-500 tabular-nums" }, `${index + 1} / ${total}`)
    }
    // The thumbs. Re-runs only when the gallery state changes (a page load,
    // an error); the scroller itself stays mounted, so its scroll position
    // survives. The ready branch wraps the anchors in a display:contents div
    // so they lay out as direct children of the scroller while the live
    // binding still returns a single node (vanjs binding funcs can't return
    // arrays).
    const Thumbs = () => {
        const g = gallery.val
        if (g.status === "loading") return div({ class: "skeleton h-14 rounded-lg" })
        if (g.status === "error") {
            return div(
                {
                    class: clsx(
                        "flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-400",
                    ),
                },
                `Couldn't load nearby posts: ${g.error}`,
                button(
                    {
                        type: "button",
                        class: "text-zinc-200 underline",
                        onclick: reloadGallery,
                    },
                    "Try again",
                ),
            )
        }
        // loadedPosts dedupes posts the feed shift put into two pages, so
        // the strip never shows a thumb twice.
        return div(
            { class: "contents" },
            loadedPosts(g).map(({ post, pid }) =>
                Thumb({
                    post,
                    origin: { ...origin, pid },
                    activeId,
                    vertical,
                }),
            ),
        )
    }
    // Scroll the active thumb into view whenever the active post or the
    // loaded pages change (a live node must return one node, so this is a
    // comment carrying the side effect).
    const ScrollActive = () => {
        activeId()
        void gallery.val
        queueMicrotask(() => {
            const active = document.querySelector<HTMLAnchorElement>('[data-gallery-active="true"]')
            active?.scrollIntoView({
                behavior: "smooth",
                block: vertical ? "center" : "nearest",
                inline: vertical ? "nearest" : "center",
            })
        })
        return document.createComment("")
    }
    // The "Gallery" heading, shared by both orientations.
    const headerLabel = span(
        {
            class: "text-xs font-semibold tracking-wider text-zinc-500 uppercase",
        },
        "Gallery",
    )
    // The vertical header stacks the label + focus button on one row with the
    // counter below, to fit the narrow strip; horizontal puts everything on
    // one row with the counter grouped next to the focus button.
    const header = vertical
        ? div(
              { class: "flex flex-col gap-1 px-0.5" },
              div({ class: "flex items-center justify-between" }, headerLabel, FocusButton()),
              Counter,
          )
        : div(
              { class: "flex items-center justify-between px-0.5" },
              headerLabel,
              div({ class: "flex items-center gap-2" }, Counter, FocusButton()),
          )
    // The scroll container, kept across gallery steps by the caller — so the
    // wheel listener below is attached exactly once per strip.
    const scroller = div(
        {
            class: clsx(
                vertical
                    ? "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto"
                    : "flex gap-1.5 overflow-x-auto pb-1",
            ),
        },
        Thumbs,
    )
    if (!vertical)
        scroller.addEventListener(
            "wheel",
            (event) => {
                // Native horizontal scrolls (trackpad swipe, shift+wheel)
                // already move the strip, and a strip that fits its width has
                // nothing to scroll — in both cases the page keeps its
                // normal wheel behaviour.
                if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
                if (scroller.scrollWidth <= scroller.clientWidth) return
                event.preventDefault()
                scroller.scrollLeft += event.deltaY
            },
            { passive: false },
        )
    return div(
        { class: clsx("flex shrink-0 flex-col gap-1.5", vertical && "w-24") },
        header,
        scroller,
        ScrollActive,
    )
}

// One filmstrip thumbnail. Built once per loaded post; the active highlight
// follows the current post via live props, so a step updates attributes in
// place instead of rebuilding the strip.
function Thumb({
    post,
    origin,
    activeId,
    vertical,
}: {
    post: Post
    origin: PostOrigin
    activeId: () => number
    vertical: boolean
}) {
    const isActive = () => post.id === activeId()
    return Link(
        {
            href: postHref(post.link, origin),
            // A filmstrip jump is gallery navigation: replace, so back exits
            // the gallery, not the previous post.
            replace: true,
            class: () =>
                clsx(
                    // border-2 across all states (not just the rose one) keeps
                    // every thumb the same size — a per-state width would make
                    // the animated thumbs 2px taller than their neighbours in
                    // the row.
                    "shrink-0 overflow-hidden rounded-md border-2 transition-opacity",
                    isActive()
                        ? "border-zinc-200 opacity-100"
                        : // Inactive animated thumbs keep a rose border so
                          // they stay findable at a glance.
                          isAnimated(post.tags)
                          ? "border-rose-500/60 opacity-50 hover:opacity-100"
                          : "border-transparent opacity-50 hover:opacity-100",
                ),
            title: `Post #${post.id}`,
            "data-gallery-active": () => (isActive() ? "true" : "false"),
        },
        img({
            src: () => thumbnailUrl(post),
            alt: `Post ${post.id}`,
            loading: "lazy",
            class: clsx(
                // The vertical thumb fills the strip's width so the anchor's
                // border hugs the image exactly.
                "object-cover",
                vertical ? "h-14 w-full" : "h-12 w-16",
            ),
            onerror: (e: Event) => {
                const image = e.currentTarget as HTMLImageElement
                if (image.getAttribute("src") !== post.thumbnail) image.src = post.thumbnail
            },
        }),
    )
}

function LoadingState() {
    // Matches the loaded layout: media first on mobile, sidebar below it;
    // sidebar left on desktop.
    return div(
        { class: "flex flex-col gap-6 lg:flex-row" },
        aside({ class: "order-last w-full shrink-0 lg:order-first lg:w-64" }, TagListSkeleton()),
        div(
            {
                class: clsx(
                    "order-first flex min-h-[60vh] min-w-0 flex-1 items-center justify-center",
                ),
            },
            div({ class: "skeleton h-96 w-full max-w-xl rounded-xl" }),
        ),
    )
}

function ErrorState(message: string) {
    return CenteredState({
        icon: "⚠️",
        title: "Couldn't load post",
        message,
        action: { label: "Try again", onclick: reloadDetails },
    })
}

export function PostDetails() {
    // The page shell (layout wrappers, filmstrip) is built once per mount and
    // kept across post steps: vanjs swaps children whose identity changed, so
    // rebuilding the shell per post would detach the filmstrip's scroll
    // container and reset its scroll position. Only the shell's varying parts
    // (sidebar content, media, filmstrip internals) are live bindings.
    // Discarded on error / first load — a detached shell's bindings are dead
    // (keepConnected), so it must never be reused after being taken off
    // screen.
    let shell: Node | undefined
    return div({ class: "min-h-[60vh]" }, () => {
        const state = details.val
        if (state.status === "error") {
            shell = undefined
            return ErrorState(state.error)
        }
        // While the next post loads, the state keeps the previous one (see
        // state/load.ts), which is what renders here; only the very first
        // load has no post and falls back to the skeleton.
        if (state.status !== "ready") {
            shell = undefined
            return LoadingState()
        }
        if (shell === undefined) shell = buildShell()
        return shell
    })
}

// The static page chrome plus the live per-post slots. Everything here stays
// mounted across post steps within the same gallery.
function buildShell(): Node {
    // "Load original right away" toggle, shared by the sidebar switch and the
    // media. Reset to the user's setting whenever the post changes (checked
    // idempotently from both slots; the sidebar slot renders first, and its
    // reset re-triggers the media's live src in the same pass).
    let showOriginalFor: number | undefined
    const showOriginal = van.state(preferOriginal.val)
    const ensureShowOriginal = (post: PostDetailsData) => {
        if (showOriginalFor !== post.id) {
            showOriginalFor = post.id
            showOriginal.val = preferOriginal.val
        }
    }
    // The filmstrip node, memoized per (orientation, origin). Rebuilt when
    // focus mode flips the strip's layout or the gallery origin changes — and
    // whenever the non-gallery branch renders, because the strip was
    // detached there and its bindings are dead (keepConnected).
    let strip: { key: string; node: Node } | undefined
    // The currently shown post's id, read from the state so the memoized
    // strip sees the active post of *now*, not the one it was built with.
    const activeId = () => (details.val.status === "ready" ? details.val.post.id : -1)

    // The favorite button's per-post status (reset per post, checked
    // idempotently like showOriginal): rule34 can't tell us beforehand
    // whether a post is favorited, so every post starts "idle" — the server
    // "already" overlay (AddFavoriteButton) is display-only and rides on the
    // shared downloaded set instead. The button is a toggle, so the
    // "added"/"already" faces double as the "Remove from favorites" face;
    // the reset also clears a per-mount terminal "stale-session".
    let favoriteFor: number | undefined
    const favorite = van.state<FavoriteStatus>("idle")
    const ensureFavorite = (post: PostDetailsData) => {
        if (favoriteFor !== post.id) {
            favoriteFor = post.id
            favorite.val = "idle"
        }
    }

    // Sidebar slot: per-post content inside the static aside. Runs before the
    // column slot (created first), so its showOriginal reset propagates to
    // the media within the same update.
    const sidebarContent = () => {
        const state = details.val
        if (state.status !== "ready") return TagListSkeleton()
        ensureShowOriginal(state.post)
        ensureFavorite(state.post)
        return Sidebar({
            post: state.post,
            showOriginal,
            favorite,
            isCurrent: () =>
                favoriteFor === state.post.id &&
                route.val.type === "postdetails" &&
                route.val.id === state.post.id,
        })
    }

    // Media slot: a stable wrapper (media holder + arrow overlay) whose
    // media content is crossfaded per post. The holder is a grid whose
    // children all occupy the same cell, so during a fade the outgoing and
    // incoming media overlap; the incoming element starts transparent and is
    // faded in once it is decodable/can-play, then the outgoing one is
    // removed. The wrapper node never changes identity — swapping it would
    // cut instead of fade.
    const mediaHolder = div({
        class: () =>
            clsx(
                "grid place-items-center",
                // In focus mode the row track is definite (minmax(0,1fr) of
                // the full-height grid) so the media's h-full resolves against
                // the viewport instead of the item's natural size.
                galleryFocus.val ? "h-full grid-rows-[minmax(0,1fr)]" : "min-h-[60vh]",
            ),
    })
    const mediaBox = div(
        { class: () => clsx("relative", galleryFocus.val && "min-h-0 min-w-0 flex-1") },
        mediaHolder,
        // A live node must return one connected node, so each arrow
        // is a live node in this static overlay.
        div(
            {
                class: clsx(
                    "pointer-events-none absolute inset-0 flex items-center justify-between px-2",
                ),
            },
            GalleryArrow({ dir: -1 }),
            GalleryArrow({ dir: 1 }),
        ),
    )
    // Mobile gallery swipe: a decisive horizontal drag starting on the media
    // steps to the adjacent post (left = next). Vertical scrolls that begin
    // on the media are left alone (horizontal-dominance check). On Chrome a
    // video's native controls consume the gesture before it reaches the page,
    // but Safari also delivers touches over them — a scrub on the seek bar
    // would read as a swipe. A scrub additionally fires `seeking` on the
    // video, so a seek while a touch is down is the signal that the gesture
    // was aimed at the controls, and it suppresses navigation.
    let swipeStart: { x: number; y: number } | undefined
    let videoSeeking = false
    mediaBox.addEventListener("touchstart", (event) => {
        const touch = event.touches[0]
        if (touch === undefined) return
        swipeStart = { x: touch.clientX, y: touch.clientY }
        // A seek from a previous, already-ended touch can't belong to this
        // one — clear it, otherwise it would suppress this swipe.
        videoSeeking = false
    })
    mediaBox.addEventListener("touchend", (event) => {
        const start = swipeStart
        swipeStart = undefined
        if (start === undefined) return
        const touch = event.changedTouches[0]
        if (touch === undefined) return
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        if (Math.abs(dx) < 48 || Math.abs(dx) < 1.5 * Math.abs(dy)) return
        const suppress = shown?.el instanceof HTMLVideoElement && videoSeeking
        videoSeeking = false
        if (suppress) return
        step(dx > 0 ? -1 : 1)
    })
    mediaBox.addEventListener("touchcancel", () => {
        swipeStart = undefined
        videoSeeking = false
    })
    let shown: { id: number; el: HTMLElement; fill: boolean } | undefined
    const swapMedia = (post: PostDetailsData, fill: boolean): void => {
        if (shown?.id === post.id) {
            // Same post, but focus mode may have flipped the sizing cap.
            if (shown.fill !== fill) {
                shown.fill = fill
                shown.el.className = mediaElementClass(fill)
            }
            return
        }
        // Drop an element from a superseded swap that never got faded in.
        for (const child of [...mediaHolder.children]) if (child !== shown?.el) child.remove()
        const prev = shown
        const next = buildMediaEl(post, showOriginal, fill)
        next.el.style.opacity = "0"
        mediaHolder.append(next.el)
        shown = { id: post.id, el: next.el, fill }
        if (next.el instanceof HTMLVideoElement)
            next.el.addEventListener("seeking", () => {
                // Only the currently shown video counts (a superseded
                // outgoing element can still settle for a moment).
                if (shown?.el === next.el) videoSeeking = true
            })
        void next.whenReady.then(() => {
            if (shown?.el !== next.el) {
                // Superseded by another step before it was ready.
                next.el.remove()
                return
            }
            next.el.style.opacity = "1"
            if (prev) window.setTimeout(() => prev.el.remove(), 250)
        })
    }
    const mediaSlot = () => {
        const state = details.val
        // Off a ready payload (only possible before the first load) the
        // previous media simply stays up.
        if (state.status === "ready") {
            ensureShowOriginal(state.post)
            swapMedia(state.post, galleryFocus.val)
        }
        return mediaBox
    }

    // Filmstrip slot: the memoized strip node, or nothing outside a gallery.
    // The strip's own live bindings follow the active post and page loads; a
    // step never swaps it, so its scroll position survives.
    const stripSlot = () => {
        const state = details.val
        if (state.status !== "ready" || state.origin === undefined) {
            // Off a gallery (or no post yet) the strip below would be
            // detached — never reuse it afterwards (keepConnected).
            strip = undefined
            return document.createComment("")
        }
        const key = `${galleryFocus.val ? "v" : "h"}:${originKey(state.origin)}`
        if (strip?.key !== key)
            strip = {
                key,
                node: Filmstrip({ origin: state.origin, activeId, vertical: galleryFocus.val }),
            }
        return strip.node
    }

    return div(
        { class: "flex flex-col gap-6 lg:flex-row" },
        aside(
            {
                // Focus mode hides the metadata sidebar so the media fills
                // the row; `display: none` keeps it mounted.
                class: () =>
                    clsx(
                        "order-last w-full shrink-0 lg:order-first lg:w-64",
                        galleryFocus.val && "hidden",
                    ),
            },
            sidebarContent,
        ),
        div(
            {
                // In focus mode the column fills the viewport exactly
                // (h-dvh, not h-screen): main drops its padding and the
                // navbar is hidden, so nothing offsets it. The media takes
                // the remaining width next to the vertical filmstrip on the
                // right, all without page scroll. On mobile Safari 100vh is
                // the *large* viewport (Safari chrome collapsed), so it
                // overflows the visible area while the bottom URL bar is
                // showing; 100dvh tracks the visible height and updates as
                // the bar shows/hides.
                class: () =>
                    clsx(
                        "order-first min-w-0",
                        // flex-1 only from lg: on mobile the column is a
                        // flex item of the flex-col shell, where flex-1's
                        // flex-basis: 0% overrides the h-dvh height (basis
                        // wins over height on the main axis) and the column
                        // grew to the media's natural size. Below lg the
                        // height is the definite 100dvh and the row fills
                        // the width regardless; at lg the shell is flex-row
                        // and flex-1 is what stretches the column to fill
                        // the width next to the vertical strip.
                        galleryFocus.val ? "flex h-dvh gap-3 lg:flex-1" : "flex-1",
                    ),
            },
            mediaSlot,
            stripSlot,
        ),
    )
}

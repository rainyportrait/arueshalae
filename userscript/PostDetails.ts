import van from "vanjs-core"
import type { ChildDom, State } from "vanjs-core"

import { CenteredState } from "./CenteredState.ts"
import { Link } from "./Link.ts"
import { TagList } from "./TagList.ts"
import { Toggle } from "./Toggle.ts"
import type { PostDetails as PostDetailsData } from "./api/post-details.ts"
import clsx from "./clsx.ts"
import { type PostOrigin, postHref, route } from "./router.ts"
import { details, reloadDetails } from "./state/details.ts"
import { canStep, gallery, galleryFocus, reloadGallery, step } from "./state/gallery.ts"
import { preferOriginal } from "./state/settings.ts"

const { a, aside, button, div, h4, img, span, video } = van.tags

function StatsSection({ post }: { post: PostDetailsData }) {
    const cells: ChildDom[] = []
    const push = (label: string, value: ChildDom) => {
        cells.push(
            span({ class: clsx("text-zinc-500") }, label),
            div({ class: clsx("min-w-0 text-right") }, value),
        )
    }
    push("Id", span({ class: clsx("tabular-nums") }, `#${post.id}`))
    if (post.title) push("Title", span({ class: clsx("wrap-break-word") }, post.title))
    if (post.posted) push("Posted", span({ class: clsx("truncate") }, post.posted))
    if (post.poster)
        push(
            "by",
            Link(
                {
                    href: post.posterHref,
                    class: clsx("truncate text-rose-300 hover:text-rose-200"),
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
                    class: clsx("break-all text-cyan-300 hover:text-cyan-200"),
                    title: post.source,
                },
                post.source,
            ),
        )
    if (post.rating) push("Rating", span({}, post.rating))
    push("Score", span({ class: clsx("tabular-nums") }, String(post.score)))

    return div(
        { class: clsx("flex flex-col gap-1") },
        h4(
            {
                class: clsx(
                    "px-1.5 pb-0.5 text-xs font-semibold tracking-wider text-zinc-500 uppercase",
                ),
            },
            "Metadata",
        ),
        div({ class: clsx("grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5 px-1.5 text-sm") }, cells),
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
        { class: clsx("rounded-xl border border-zinc-800 bg-zinc-900/40 p-4") },
        Toggle({
            label: "Original image",
            description: "Show the full-resolution image instead of the sample.",
            state: showOriginal,
            onToggle: (value) => (showOriginal.val = value),
        }),
    )
}

function Sidebar({ post, showOriginal }: { post: PostDetailsData; showOriginal: State<boolean> }) {
    return div(
        { class: clsx("flex flex-col gap-6") },
        OriginalImageToggle({ post, showOriginal }),
        StatsSection({ post }),
        TagList({ tags: post.tags }),
    )
}

function MediaArea({
    post,
    showOriginal,
    // In focus mode the wrapper's height is set by the layout (flex-1), so
    // the media is capped by its container instead of the viewport.
    fill = false,
}: {
    post: PostDetailsData
    showOriginal: State<boolean>
    fill?: boolean
}) {
    const media = post.media
    const elementClass = clsx(fill ? "max-h-full" : "max-h-[80vh]", "w-auto max-w-full rounded-lg")
    const element =
        media.kind === "video"
            ? video({
                  src: media.src,
                  poster: media.poster,
                  controls: true,
                  loop: true,
                  muted: true,
                  autoplay: true,
                  class: elementClass,
              })
            : img({
                  // Function prop: re-runs when showOriginal changes, swapping
                  // the displayed image for the original (and back).
                  src: () =>
                      showOriginal.val && media.originalImage ? media.originalImage : media.src,
                  alt: post.title ? `Post ${post.id}: ${post.title}` : `Post ${post.id}`,
                  class: elementClass,
              })
    return div(
        { class: clsx("flex items-center justify-center", fill ? "h-full" : "min-h-[60vh]") },
        element,
    )
}

// One side of the gallery: a live node returning a chevron button. Disabled
// (and inert) when there is no post in that direction.
function GalleryArrow({ dir }: { dir: 1 | -1 }) {
    return () => {
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
            title: () => (galleryFocus.val ? "Exit focus mode" : "Focus mode: hide navigation"),
            onclick: () => {
                galleryFocus.val = !galleryFocus.val
            },
        },
        () =>
            span({
                "icon-name": galleryFocus.val ? "minimize" : "maximize",
                class: clsx("text-sm"),
            }),
    )
}

// The gallery filmstrip: the collection's loaded posts as thumbnails, with a
// position counter. The strip grows as boundary steps load more pages.
function Filmstrip({ origin, activeId }: { origin: PostOrigin; activeId: number }) {
    return div({ class: clsx("flex shrink-0 flex-col gap-1.5") }, () => {
        const g = gallery.val
        if (g.status === "loading") return div({ class: clsx("skeleton h-14 rounded-lg") })
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
                        class: clsx("text-zinc-200 underline"),
                        onclick: reloadGallery,
                    },
                    "Try again",
                ),
            )
        }
        const posts = g.pages.flatMap((p) => p.posts)
        const index = posts.findIndex((p) => p.id === activeId)
        return div(
            div(
                { class: clsx("flex items-center justify-between px-0.5") },
                span(
                    { class: clsx("text-xs font-semibold tracking-wider text-zinc-500 uppercase") },
                    "Gallery",
                ),
                div(
                    { class: clsx("flex items-center gap-2") },
                    index === -1
                        ? document.createComment("")
                        : span(
                              { class: clsx("text-xs text-zinc-500 tabular-nums") },
                              `${index + 1} / ${posts.length}`,
                          ),
                    FocusButton(),
                ),
            ),
            div(
                { class: clsx("flex gap-1.5 overflow-x-auto pb-1") },
                posts.map((post) =>
                    Link(
                        {
                            href: postHref(post.link, origin),
                            // A filmstrip jump is gallery navigation: replace,
                            // so back exits the gallery, not the previous post.
                            replace: true,
                            class: clsx(
                                "shrink-0 overflow-hidden rounded-md border transition-opacity",
                                post.id === activeId
                                    ? "border-zinc-200 opacity-100"
                                    : "border-transparent opacity-50 hover:opacity-100",
                            ),
                            title: `Post #${post.id}`,
                            ...(post.id === activeId ? { "data-gallery-active": "true" } : {}),
                        },
                        img({
                            src: post.thumbnail,
                            alt: `Post ${post.id}`,
                            loading: "lazy",
                            class: clsx("h-12 w-16 object-cover"),
                        }),
                    ),
                ),
            ),
            // Scroll the active thumb into view after each render.
            () => {
                queueMicrotask(() => {
                    const active = document.querySelector<HTMLAnchorElement>(
                        '[data-gallery-active="true"]',
                    )
                    active?.scrollIntoView({
                        behavior: "smooth",
                        block: "nearest",
                        inline: "center",
                    })
                })
                return document.createComment("")
            },
        )
    })
}

function LoadingState() {
    // Matches the loaded layout: media first on mobile, sidebar below it;
    // sidebar left on desktop.
    return div(
        { class: clsx("flex flex-col gap-6 lg:flex-row") },
        aside(
            { class: clsx("order-last w-full shrink-0 lg:order-first lg:w-64") },
            div(
                { class: clsx("flex flex-col gap-2.5") },
                Array.from({ length: 12 }).map((_, i) =>
                    div({
                        class: clsx("skeleton h-4 rounded"),
                        style: `width: ${90 - (i % 4) * 15}%`,
                    }),
                ),
            ),
        ),
        div(
            {
                class: clsx(
                    "order-first flex min-h-[60vh] min-w-0 flex-1 items-center justify-center",
                ),
            },
            div({ class: clsx("skeleton h-96 w-full max-w-xl rounded-xl") }),
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
    return div({ class: clsx("min-h-[60vh]") }, () => {
        const state = details.val
        if (state.status === "loading") return LoadingState()
        if (state.status === "error") return ErrorState(state.error)
        // Fresh per post: the toggle resets whenever the details change, but
        // starts from the user's "load original right away" setting.
        const showOriginal = van.state(preferOriginal.val)
        // The gallery (arrows + filmstrip) shows when the post was opened
        // from a list or favorites page — the origin rides on the URL.
        const r = route.val
        const origin = r.type === "postdetails" ? r.origin : undefined
        const focus = galleryFocus.val
        // Sidebar sits left of the media on desktop; on narrow screens it
        // stacks below the media at full width.
        return div(
            { class: clsx("flex flex-col gap-6 lg:flex-row") },
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
                Sidebar({ post: state.post, showOriginal }),
            ),
            div(
                {
                    // In focus mode the column fills the viewport minus the
                    // main's vertical padding (py-6 = 3rem): the media grows
                    // into the space above the filmstrip, which stays pinned
                    // to the bottom, all without page scroll.
                    class: () =>
                        clsx("order-first min-w-0 flex-1", focus && "flex h-screen flex-col gap-3"),
                },
                origin !== undefined
                    ? [
                          div(
                              { class: () => clsx("relative", focus && "min-h-0 flex-1") },
                              MediaArea({ post: state.post, showOriginal, fill: focus }),
                              // A live node must return one connected node, so
                              // each arrow is a live node in this static overlay.
                              div(
                                  {
                                      class: clsx(
                                          "pointer-events-none absolute inset-0 flex items-center justify-between px-2",
                                      ),
                                  },
                                  GalleryArrow({ dir: -1 }),
                                  GalleryArrow({ dir: 1 }),
                              ),
                          ),
                          Filmstrip({ origin, activeId: state.post.id }),
                      ]
                    : MediaArea({ post: state.post, showOriginal }),
            ),
        )
    })
}

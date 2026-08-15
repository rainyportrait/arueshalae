import van from "vanjs-core/src/van"
import type { ChildDom, State } from "vanjs-core/src/van"

import { Link } from "./Link"
import { TagList } from "./TagList"
import type { PostDetails as PostDetailsData } from "./api/post-details"
import clsx from "./clsx"
import { details, reloadDetails } from "./state"

const { a, aside, button, div, h2, h4, img, p, span, video } = van.tags

function StatsSection({ post }: { post: PostDetailsData }) {
    const cells: ChildDom[] = []
    const push = (label: string, value: ChildDom) => {
        cells.push(
            span({ class: "text-zinc-500" }, label),
            div({ class: "min-w-0 text-right" }, value),
        )
    }
    push("Id", span({ class: "tabular-nums" }, `#${post.id}`))
    if (post.posted) push("Posted", span({ class: "truncate" }, post.posted))
    if (post.poster)
        push(
            "by",
            Link(
                { href: post.posterHref, class: "truncate text-rose-300 hover:text-rose-200" },
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
                class: "px-1.5 pb-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-500",
            },
            "Statistics",
        ),
        div({ class: "grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-1.5 text-sm" }, cells),
    )
}

// Toggles the displayed image between the (possibly sample) image and the
// full-size file from the "Original image" sidebar link. Image posts only,
// and hidden when the displayed image is already the original (small images
// don't get a sample, so the two URLs are identical).
function OriginalImageButton({
    post,
    showOriginal,
}: {
    post: PostDetailsData
    showOriginal: State<boolean>
}) {
    const media = post.media
    if (media.kind !== "image" || !media.originalImage || media.originalImage === media.src)
        return null
    return button(
        {
            class: () =>
                clsx(
                    "w-full rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    showOriginal.val
                        ? "border-rose-500/60 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/60",
                ),
            onclick: () => (showOriginal.val = !showOriginal.val),
        },
        () => (showOriginal.val ? "View sample image" : "View original image"),
    )
}

function Sidebar({ post, showOriginal }: { post: PostDetailsData; showOriginal: State<boolean> }) {
    return div(
        { class: "flex flex-col gap-6" },
        OriginalImageButton({ post, showOriginal }),
        StatsSection({ post }),
        TagList({ tags: post.tags }),
    )
}

function MediaArea({
    post,
    showOriginal,
}: {
    post: PostDetailsData
    showOriginal: State<boolean>
}) {
    const media = post.media
    const element =
        media.kind === "video"
            ? video({
                  src: media.src,
                  poster: media.poster,
                  controls: true,
                  loop: true,
                  muted: true,
                  autoplay: true,
                  class: "max-h-[80vh] w-auto max-w-full rounded-lg",
              })
            : img({
                  // Function prop: re-runs when showOriginal changes, swapping
                  // the displayed image for the original (and back).
                  src: () =>
                      showOriginal.val && media.originalImage ? media.originalImage : media.src,
                  alt: post.title ? `Post ${post.id}: ${post.title}` : `Post ${post.id}`,
                  class: "max-h-[80vh] w-auto max-w-full rounded-lg",
              })
    return div(
        { class: "flex min-h-[60vh] flex-col items-center justify-center gap-4" },
        element,
        post.title
            ? h2({ class: "text-center text-lg font-medium text-zinc-200" }, post.title)
            : null,
    )
}

function LoadingState() {
    return div(
        { class: "flex gap-6" },
        aside(
            { class: "hidden w-64 shrink-0 lg:block" },
            div(
                { class: "flex flex-col gap-2.5" },
                Array.from({ length: 12 }).map((_, i) =>
                    div({ class: "skeleton h-4 rounded", style: `width: ${90 - (i % 4) * 15}%` }),
                ),
            ),
        ),
        div(
            { class: "flex min-h-[60vh] min-w-0 flex-1 items-center justify-center" },
            div({ class: "skeleton h-96 w-full max-w-xl rounded-xl" }),
        ),
    )
}

function ErrorState(message: string) {
    return div(
        { class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
        span({ class: "text-4xl" }, "⚠️"),
        h2({ class: "mt-2 text-lg font-medium text-zinc-200" }, "Couldn't load post"),
        p({ class: "max-w-md px-4 text-sm text-zinc-500" }, message),
        button(
            {
                class: clsx(
                    "mt-3 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                    "transition-colors hover:bg-rose-400",
                ),
                onclick: () => reloadDetails(),
            },
            "Try again",
        ),
    )
}

export function PostDetails() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = details.val
        if (state.status === "loading") return LoadingState()
        if (state.status === "error") return ErrorState(state.error)
        // Fresh per post: the toggle resets whenever the details change.
        const showOriginal = van.state(false)
        return div(
            { class: "flex gap-6" },
            aside(
                { class: "hidden w-64 shrink-0 lg:block" },
                Sidebar({ post: state.post, showOriginal }),
            ),
            div({ class: "min-w-0 flex-1" }, MediaArea({ post: state.post, showOriginal })),
        )
    })
}

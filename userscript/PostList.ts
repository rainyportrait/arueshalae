import van from "vanjs-core/src/van"

import { Pagination } from "./Pagination"
import { PostCard } from "./PostCard"
import clsx from "./clsx"
import { list, reloadList } from "./state"

const { button, div, h2, p, span } = van.tags

// A handful of placeholder heights so the skeleton mimics the masonry flow.
const SKELETON_HEIGHTS = [
    "h-40",
    "h-64",
    "h-32",
    "h-56",
    "h-48",
    "h-60",
    "h-44",
    "h-52",
    "h-36",
    "h-64",
    "h-40",
    "h-56",
]

function SkeletonGrid() {
    return div(
        { class: "masonry" },
        SKELETON_HEIGHTS.map((height) =>
            div(
                {
                    class: "masonry-item overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900",
                },
                div({ class: clsx("skeleton w-full", height) }),
            ),
        ),
    )
}

function EmptyState() {
    return div(
        { class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
        span({ class: "text-4xl" }, "🔍"),
        h2({ class: "mt-2 text-lg font-medium text-zinc-200" }, "No posts found"),
        p({ class: "text-sm text-zinc-500" }, "Try a different search or check your tags."),
    )
}

function ErrorState(message: string) {
    return div(
        { class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
        span({ class: "text-4xl" }, "⚠️"),
        h2({ class: "mt-2 text-lg font-medium text-zinc-200" }, "Couldn't load posts"),
        p({ class: "max-w-md px-4 text-sm text-zinc-500" }, message),
        button(
            {
                class: clsx(
                    "mt-3 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                    "transition-colors hover:bg-rose-400",
                ),
                onclick: () => reloadList(),
            },
            "Try again",
        ),
    )
}

export function PostList() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = list.val
        if (state.status === "loading") return SkeletonGrid()
        if (state.status === "error") return ErrorState(state.error)
        if (state.posts.length === 0) return EmptyState()
        return div(
            { class: "flex flex-col" },
            div(
                { class: "masonry" },
                state.posts.map((post) => PostCard(post)),
            ),
            Pagination(),
        )
    })
}

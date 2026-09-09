import van from "vanjs-core"

import { CenteredState } from "./CenteredState.ts"
import { Pagination } from "./Pagination.ts"
import { PostCard } from "./PostCard.ts"
import { type Post } from "./api/post-list.ts"
import clsx from "./clsx.ts"
import { MASONRY_GAP } from "./masonry.ts"
import { type Route } from "./router.ts"
import { type Loadable } from "./state/load.ts"

const { div } = van.tags

// Each skeleton item's grid span is its height plus the row gap, exactly as
// real cards are sized.
const SKELETON_HEIGHTS = [152, 272, 152, 360, 208, 432, 272, 152, 360, 208, 432, 272]

function SkeletonGrid() {
    return div(
        { class: "masonry" },
        SKELETON_HEIGHTS.map((height) =>
            div(
                {
                    class: clsx(
                        "masonry-item overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900",
                    ),
                    style: `grid-row-end: span ${height + MASONRY_GAP}`,
                },
                div({ class: "skeleton w-full", style: `height: ${height}px` }),
            ),
        ),
    )
}

export interface PostGridProps {
    state: Loadable<{ posts: Post[] }>
    // Pagination, computed by the caller from its own state and page size.
    currentPage: number
    totalPages: number
    routeForPage: (page: number) => Route
    // Copy for the empty state.
    empty: { icon: string; title: string; message: string }
    errorTitle: string
    onRetry: () => void
}

// The masonry post grid with its loading, error and empty states plus
// pagination. Shared by the post list and the favorites page. Plain (not
// live) — the caller renders it from its own live function, which is what
// makes the state reads reactive.
export function PostGrid({
    state,
    currentPage,
    totalPages,
    routeForPage,
    empty,
    errorTitle,
    onRetry,
}: PostGridProps): HTMLDivElement {
    if (state.status === "error") {
        return CenteredState({
            icon: "⚠️",
            title: errorTitle,
            message: state.error,
            action: { label: "Try again", onclick: onRetry },
        })
    }
    // "loading" only ever holds the initial state (see state/load.ts): while
    // a new page loads the state keeps the previous one, which renders here.
    if (state.status === "loading") return SkeletonGrid()
    if (state.posts.length === 0) return CenteredState(empty)

    return div(
        { class: "flex flex-col" },
        div(
            { class: "masonry" },
            state.posts.map((post) => PostCard(post)),
        ),
        Pagination({ currentPage, totalPages, routeForPage }),
    )
}

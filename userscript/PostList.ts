import van from "vanjs-core"
import type { ChildDom } from "vanjs-core"

import { CenteredState } from "./CenteredState.ts"
import { Pagination } from "./Pagination.ts"
import { PostCard } from "./PostCard.ts"
import { TagList } from "./TagList.ts"
import { MASONRY_GAP } from "./masonry.ts"
import { list, reloadList } from "./state/list.ts"

const { aside, div } = van.tags

// Placeholder heights (px) so the skeleton mimics the masonry flow. Each item's
// grid span is its height plus the row gap, exactly as real cards are sized.
const SKELETON_HEIGHTS = [160, 256, 128, 224, 192, 240, 176, 208, 144, 256, 160, 224]

// Varying widths so the tag-list skeleton reads as a list of tag rows.
const TAG_SKELETON_WIDTHS = ["80%", "65%", "90%", "55%", "70%", "45%", "85%", "60%", "75%", "50%"]

function SkeletonGrid() {
    return div(
        { class: "masonry" },
        SKELETON_HEIGHTS.map((height) =>
            div(
                {
                    class: "masonry-item overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900",
                    style: `grid-row-end: span ${height + MASONRY_GAP}`,
                },
                div({ class: "skeleton w-full", style: `height: ${height}px` }),
            ),
        ),
    )
}

function TagListSkeleton() {
    return div(
        { class: "flex flex-col gap-2.5" },
        TAG_SKELETON_WIDTHS.map((width) =>
            div({ class: "skeleton h-4 rounded", style: `width: ${width}` }),
        ),
    )
}

// Shared layout: a fixed-width tag sidebar on the left (desktop only) with the
// post grid filling the rest. The sidebar is hidden on small screens, where the
// grid takes the full width.
function PostListLayout({ sidebar, main }: { sidebar: ChildDom; main: ChildDom }) {
    return div(
        { class: "flex gap-6" },
        aside({ class: "hidden w-64 shrink-0 sm:block" }, sidebar),
        div({ class: "min-w-0 flex-1" }, main),
    )
}

function EmptyState() {
    return CenteredState({
        icon: "🔍",
        title: "No posts found",
        message: "Try a different search or check your tags.",
    })
}

function ErrorState(message: string) {
    return CenteredState({
        icon: "⚠️",
        title: "Couldn't load posts",
        message,
        action: { label: "Try again", onclick: reloadList },
    })
}

export function PostList() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = list.val
        if (state.status === "loading") {
            return PostListLayout({ sidebar: TagListSkeleton(), main: SkeletonGrid() })
        }
        if (state.status === "error") return ErrorState(state.error)
        if (state.posts.length === 0) return EmptyState()
        return PostListLayout({
            sidebar: TagList({ tags: state.tags }),
            main: div(
                { class: "flex flex-col" },
                div(
                    { class: "masonry" },
                    state.posts.map((post) => PostCard(post)),
                ),
                Pagination(),
            ),
        })
    })
}

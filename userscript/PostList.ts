import van from "vanjs-core"
import type { ChildDom } from "vanjs-core"

import { PostGrid } from "./PostGrid.ts"
import { TagList } from "./TagList.ts"
import { routeToUrl } from "./router.ts"
import { PAGE_SIZE, list, pid, reloadList, tags } from "./state/list.ts"

const { aside, div } = van.tags

// Varying widths so the tag-list skeleton reads as a list of tag rows.
const TAG_SKELETON_WIDTHS = ["80%", "65%", "90%", "55%", "70%", "45%", "85%", "60%", "75%", "50%"]

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

export function PostList() {
    return div({ class: "min-h-[60vh]" }, () => {
        const state = list.val
        const grid = PostGrid({
            state,
            currentPage: Math.floor(pid.val / PAGE_SIZE) + 1,
            totalPages:
                state.status === "ready"
                    ? Math.max(1, Math.round(state.lastPagePID / PAGE_SIZE) + 1)
                    : 1,
            pageHref: (page) =>
                routeToUrl({ type: "postlist", tags: tags.val, pid: (page - 1) * PAGE_SIZE }),
            empty: {
                icon: "🔍",
                title: "No posts found",
                message: "Try a different search or check your tags.",
            },
            errorTitle: "Couldn't load posts",
            onRetry: reloadList,
        })
        // The tag sidebar exists while loading (as a skeleton) and once the
        // list is ready; error and empty states render full width.
        if (state.status === "loading" || state.status === "ready") {
            return PostListLayout({
                sidebar:
                    state.status === "ready" ? TagList({ tags: state.tags }) : TagListSkeleton(),
                main: grid,
            })
        }
        return grid
    })
}

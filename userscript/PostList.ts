import van from "vanjs-core"
import type { ChildDom } from "vanjs-core"

import { PostGrid } from "./PostGrid.ts"
import { TagList, TagListSkeleton } from "./TagList.ts"
import { type Post } from "./api/post-list.ts"
import clsx from "./clsx.ts"
import type { Route } from "./router.ts"
import { type ListReady, PAGE_SIZE, list, pid, reloadList, tags } from "./state/list.ts"
import { type Loadable } from "./state/load.ts"
import { filterByBlacklist, showHiddenPosts, tagBlacklist } from "./state/settings.ts"

const { aside, button, div } = van.tags

// Sidebar element reporting how many posts the blacklist is hiding, with a
// click to reveal them (and hide them again). Zero-footprint (a comment) when
// nothing is hidden. Reads `showHiddenPosts` through function props so the
// label and styling stay in sync.
function HiddenPostsToggle({ count }: { count: number }): ChildDom {
    if (count === 0) return document.createComment("")
    return button(
        {
            type: "button",
            class: () =>
                clsx(
                    "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    showHiddenPosts.val
                        ? "border-rose-500/60 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25"
                        : "border-zinc-700 bg-zinc-800/60 text-zinc-200 hover:bg-zinc-700/60",
                ),
            onclick: () => (showHiddenPosts.val = !showHiddenPosts.val),
        },
        () => (showHiddenPosts.val ? `👁 ${count} hidden — showing` : `🙈 ${count} hidden`),
    )
}

function PostListLayout({ sidebar, main }: { sidebar: ChildDom; main: ChildDom }) {
    return div(
        { class: clsx("flex gap-6") },
        aside({ class: clsx("hidden w-64 shrink-0 sm:block") }, sidebar),
        div({ class: clsx("min-w-0 flex-1") }, main),
    )
}

export function PostList() {
    return div({ class: clsx("min-h-[60vh]") }, () => {
        const state = list.val
        // The page on screen: the ready page; null during the very first load,
        // where a skeleton stands in. While a new page loads the state keeps
        // the previous one (see state/load.ts), so this is the old page and it
        // stays on screen until the new data arrives.
        const source: ListReady | null = state.status === "ready" ? state : null
        // Apply the tag blacklist to the ready page: split into the posts to
        // show and how many are hidden. Off the ready state there is nothing
        // to filter, so the state passes through untouched.
        let gridState: Loadable<{ posts: Post[] }> = state
        let hidden = 0
        let allHidden = false
        if (state.status === "ready") {
            const filtered = filterByBlacklist(state.posts, tagBlacklist.val)
            hidden = filtered.hidden.length
            allHidden =
                !showHiddenPosts.val && state.posts.length > 0 && filtered.visible.length === 0
            // Reveal everything when "show hidden" is on; otherwise only the
            // posts that don't match the blacklist.
            gridState = {
                ...state,
                posts: showHiddenPosts.val ? state.posts : filtered.visible,
            }
        }

        // Pagination follows the page on screen (source), so while a new page
        // loads the old page's own number and links stay in place; only the
        // first load (no source) has none.
        const grid = PostGrid({
            state: gridState,
            currentPage: Math.floor((source?.pid ?? pid.val) / PAGE_SIZE) + 1,
            totalPages: source ? Math.max(1, Math.round(source.lastPagePID / PAGE_SIZE) + 1) : 1,
            routeForPage: (page): Route => ({
                type: "postlist",
                tags: source?.query ?? tags.val,
                pid: (page - 1) * PAGE_SIZE,
            }),
            empty: allHidden
                ? {
                      icon: "🙈",
                      title: "All posts hidden",
                      message:
                          "Every post on this page matches your blacklist. Use the toggle in the sidebar to reveal them.",
                  }
                : {
                      icon: "🔍",
                      title: "No posts found",
                      message: "Try a different search or check your tags.",
                  },
            errorTitle: "Couldn't load posts",
            onRetry: reloadList,
        })
        // The tag sidebar exists while loading (as a skeleton during the first
        // load) and once the list is ready; error states render full width.
        if (state.status === "loading" || state.status === "ready") {
            return PostListLayout({
                sidebar:
                    source !== null
                        ? div(
                              { class: clsx("flex flex-col gap-6") },
                              HiddenPostsToggle({ count: hidden }),
                              TagList({ tags: source.tags }),
                          )
                        : TagListSkeleton(),
                main: grid,
            })
        }
        return grid
    })
}

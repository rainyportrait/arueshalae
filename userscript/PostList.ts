import van from "vanjs-core"
import type { ChildDom } from "vanjs-core"

import { PostGrid } from "./PostGrid.ts"
import { TagList, TagListSkeleton } from "./TagList.ts"
import { type Post } from "./api/post-list.ts"
import { type Tag } from "./api/tags.ts"
import clsx from "./clsx.ts"
import type { Route } from "./router.ts"
import { type ListReady, PAGE_SIZE, list, pid, reloadList, tags } from "./state/list.ts"
import { type Loadable } from "./state/load.ts"
import { filterByBlacklist, showHiddenPosts, tagBlacklist } from "./state/settings.ts"

const { aside, button, div, span } = van.tags

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

// The tag list behind a disclosure, for narrow screens where the sidebar
// drops off. Expands in place to the same TagList the desktop sidebar
// renders (TagGroup's per-type collapsing carries over). The open state is
// module-scoped, like TagGroup's collapse map, so a settle (a new page, a
// revalidation re-render) never resets it — and it is deliberately not reset
// on navigation, so tapping a tag in the open card keeps it open on the new
// page for continued exploration.
const mobileTagsOpen = van.state(false)

function MobileTagList({ tags }: { tags: Tag[] }): ChildDom {
    if (tags.length === 0) return document.createComment("")
    return div(
        { class: clsx("overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40") },
        button(
            {
                type: "button",
                "aria-expanded": () => mobileTagsOpen.val,
                class: () =>
                    clsx(
                        "flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2",
                        "text-sm text-zinc-200 transition-colors hover:bg-zinc-800/60",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40",
                        // The open state keeps the hover tone, so the button
                        // reads as active rather than just recently clicked.
                        mobileTagsOpen.val && "bg-zinc-800/60",
                    ),
                onclick: () => (mobileTagsOpen.val = !mobileTagsOpen.val),
            },
            div(
                { class: clsx("flex min-w-0 items-baseline gap-2") },
                span({ class: clsx("shrink-0 font-medium") }, "Tags"),
                span({ class: clsx("text-xs text-zinc-500 tabular-nums") }, String(tags.length)),
            ),
            span({
                "icon-name": "chevron-down",
                class: () =>
                    clsx(
                        "shrink-0 text-zinc-400 transition-transform",
                        // Same convention as TagGroup: down while collapsed,
                        // flipped up while expanded.
                        mobileTagsOpen.val && "rotate-180",
                    ),
            }),
        ),
        // The open content is a live node reading the shared open state, so a
        // toggle swaps only this slot. It must return a connected node even
        // while closed (a comment), or the binding is dropped and never
        // re-opens.
        () =>
            mobileTagsOpen.val
                ? div({ class: clsx("border-t border-zinc-800 px-3 pt-3 pb-3") }, TagList({ tags }))
                : document.createComment(""),
    )
}

// The mobile stand-in for the sidebar: the hidden-posts toggle (which must
// stay reachable on mobile — the "all hidden" empty state points at it) and
// the tag disclosure. Both children are zero-footprint comments when they
// have nothing to show, in which case the block drops out too (an empty
// flex item would still take the parent's gap).
function MobileSidebar({ hidden, tags }: { hidden: number; tags: Tag[] }): ChildDom {
    if (hidden === 0 && tags.length === 0) return document.createComment("")
    return div(
        // Hidden above PostListLayout's swap point, like the aside it replaces.
        { class: clsx("flex flex-col gap-2 min-[808px]:hidden") },
        HiddenPostsToggle({ count: hidden }),
        MobileTagList({ tags }),
    )
}

function PostListLayout({
    mobile,
    sidebar,
    main,
}: {
    mobile: ChildDom
    sidebar: ChildDom
    main: ChildDom
}) {
    // The sidebar swaps in at 808px: the viewport at which the tagless grid
    // becomes three columns (3 × 252px tracks + 2 × 16px gaps + 20px page
    // padding). Below it the wide two-column grid is worth more than the tag
    // list, so the mobile layout stays up until the sidebar can be paid for
    // with a column.
    return div(
        { class: clsx("flex flex-col gap-4 min-[808px]:flex-row min-[808px]:gap-6") },
        mobile,
        aside({ class: clsx("hidden w-64 shrink-0 min-[808px]:block") }, sidebar),
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
                      // Device-neutral on purpose: on mobile the toggle sits
                      // in the bar above the grid, not in a sidebar.
                      message:
                          "Every post on this page matches your blacklist. Use the hidden-posts toggle to reveal them.",
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
                mobile:
                    source !== null
                        ? MobileSidebar({ hidden, tags: source.tags })
                        : document.createComment(""),
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

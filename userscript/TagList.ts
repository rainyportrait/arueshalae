import van from "vanjs-core"
import type { State } from "vanjs-core"

import { Link } from "./Link.ts"
import type { Tag, TagType } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { routeToUrl } from "./router.ts"

const { div, button, span } = van.tags

type TagMeta = { label: string; color: string }

// Muted pastels that echo the original site's per-type tag colors while fitting
// the zinc/rose theme. `general` is neutral to sit with the base text color.
// Exported so the search autocomplete can color its entries the same way.
export const TAG_META: Record<TagType, TagMeta> = {
    copyright: { label: "Copyright", color: "text-fuchsia-300" },
    character: { label: "Character", color: "text-amber-300" },
    artist: { label: "Artist", color: "text-rose-300" },
    general: { label: "General", color: "text-zinc-300" },
    metadata: { label: "Meta", color: "text-cyan-300" },
}

// Group a flat tag list by type, preserving first-seen order of each type and
// the tag order within each type.
function groupByType(tags: Tag[]): [TagType, Tag[]][] {
    return Object.entries(Object.groupBy(tags, (tag) => tag.type)) as [TagType, Tag[]][]
}

function TagLink({ tag }: { tag: Tag }) {
    return Link(
        {
            href: routeToUrl({ type: "postlist", tags: tag.slug, pid: 0 }),
            title: tag.slug,
            class: clsx(
                "flex items-baseline gap-2 rounded px-2 py-1",
                "transition-colors hover:bg-zinc-800/60",
            ),
        },
        span({ class: clsx("min-w-0 truncate text-sm", TAG_META[tag.type].color) }, tag.name),
        span(
            {
                class: clsx("ml-auto shrink-0 text-xs text-zinc-500 tabular-nums"),
            },
            tag.count.toLocaleString(),
        ),
    )
}

// Collapse state lives at module scope, keyed by tag type: TagGroup is a
// plain function re-called on every render of its parent (a page turn, a
// fetch settling, ...), so a per-call state would be re-created and silently
// re-expand every group the user had collapsed.
const collapsedByType = new Map<TagType, State<boolean>>()
function collapsedState(type: TagType): State<boolean> {
    let s = collapsedByType.get(type)
    if (s === undefined) {
        s = van.state(false)
        collapsedByType.set(type, s)
    }
    return s
}

// One tag-type group with a clickable heading that toggles collapse. Collapsed,
// it shows the first tag plus a count of the hidden ones.
function TagGroup({ type, tags }: { type: TagType; tags: Tag[] }) {
    const collapsed = collapsedState(type)
    // A single-tag group can't collapse, so its heading stays inert (no cursor,
    // hover, or chevron) to avoid dead affordances.
    const interactive = tags.length > 1
    // Live node: re-runs when `collapsed` changes (or the parent re-renders),
    // swapping between the collapsed and expanded markup.
    return () => {
        const isCollapsed = interactive && collapsed.val
        return div(
            { class: clsx("flex flex-col gap-1") },
            button(
                {
                    class: clsx(
                        "flex justify-between gap-1 text-xs font-semibold tracking-wider text-zinc-500 uppercase",
                        "transition-colors select-none not-disabled:cursor-pointer not-disabled:hover:text-zinc-300",
                    ),
                    disabled: !interactive,
                    onclick: () => (collapsed.val = !collapsed.val),
                },
                TAG_META[type].label,
                // `false` isn't a valid child (it renders as "false"), so
                // build the children list conditionally.
                ...(interactive
                    ? [
                          span({
                              "icon-name": "chevron-down",
                              // Same convention as the Navbar menu: points down
                              // while collapsed, flips up while expanded.
                              class: clsx(
                                  "text-zinc-400 transition-transform",
                                  !isCollapsed && "rotate-180",
                              ),
                          }),
                      ]
                    : []),
            ),
            // The tag block is indented as a whole (hover highlights included),
            // so it reads as nested under the heading rather than flush with it.
            div(
                { class: clsx("flex flex-col gap-2") },
                isCollapsed
                    ? [
                          TagLink({ tag: tags[0] }),
                          ...(tags.length > 1
                              ? [
                                    button(
                                        {
                                            class: clsx(
                                                "cursor-pointer px-2 text-left text-xs text-zinc-500 transition-colors select-none not-disabled:hover:text-zinc-300",
                                            ),
                                            onclick: () => (collapsed.val = !collapsed.val),
                                        },
                                        `${tags.length - 1} more ${tags.length - 1 === 1 ? "tag" : "tags"}`,
                                    ),
                                ]
                              : []),
                      ]
                    : tags.map((tag) => TagLink({ tag })),
            ),
        )
    }
}

// Varying widths so the tag-list skeleton reads as a list of tag rows.
const TAG_SKELETON_WIDTHS = ["80%", "65%", "90%", "55%", "70%", "45%", "85%", "60%", "75%", "50%"]

// The tag sidebar while its page is on its first load: one skeleton row per
// tag. Shared by the post list and the post details page, whose sidebars both
// stand in with this.
export function TagListSkeleton() {
    return div(
        { class: clsx("flex flex-col gap-2.5") },
        TAG_SKELETON_WIDTHS.map((width) =>
            div({ class: clsx("skeleton h-4 rounded"), style: `width: ${width}` }),
        ),
    )
}

export function TagList({ tags }: { tags: Tag[] }) {
    if (tags.length === 0) return div()
    return div(
        { class: clsx("flex flex-col gap-4") },
        groupByType(tags).map(([type, group]) => TagGroup({ type, tags: group })),
    )
}

import van from "vanjs-core"

import { Link } from "./Link.ts"
import type { Tag, TagType } from "./api/tags.ts"
import clsx from "./clsx.ts"

const { div, h4, span } = van.tags

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
    const order: TagType[] = []
    const groups = new Map<TagType, Tag[]>()
    for (const tag of tags) {
        let group = groups.get(tag.type)
        if (!group) {
            group = []
            groups.set(tag.type, group)
            order.push(tag.type)
        }
        group.push(tag)
    }
    return order.map((type) => [type, groups.get(type)!])
}

function TagLink({ tag }: { tag: Tag }) {
    return Link(
        {
            href: `/index.php?page=post&s=list&tags=${encodeURIComponent(tag.slug)}`,
            title: tag.slug,
            class: clsx(
                "-mx-1.5 flex items-baseline gap-2 rounded px-1.5 py-1",
                "transition-colors hover:bg-zinc-800/60",
            ),
        },
        span({ class: clsx("min-w-0 truncate text-sm", TAG_META[tag.type].color) }, tag.name),
        span(
            {
                class: "ml-auto shrink-0 text-xs tabular-nums text-zinc-500",
            },
            tag.count.toLocaleString(),
        ),
    )
}

// Reusable, presentational tag list. Takes a flat list of tags and renders them
// grouped by type, each as a link that searches for that single tag.
export function TagList({ tags }: { tags: Tag[] }) {
    if (tags.length === 0) return div()
    return div(
        { class: "flex flex-col gap-4" },
        groupByType(tags).map(([type, group]) =>
            div(
                { class: "flex flex-col gap-1" },
                h4(
                    {
                        class: "px-1.5 pb-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-500",
                    },
                    TAG_META[type].label,
                ),
                group.map((tag) => TagLink({ tag })),
            ),
        ),
    )
}

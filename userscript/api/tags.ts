import { parseCount, queryParam } from "./parse.ts"

export type TagType = "copyright" | "character" | "artist" | "general" | "metadata"

export type Tag = {
    name: string
    slug: string
    type: TagType
    count: number
}

// Exported so the autocomplete can validate its `type` field the same way.
export const KNOWN_TYPES: ReadonlySet<string> = new Set([
    "copyright",
    "character",
    "artist",
    "general",
    "metadata",
])

// Parse the tag sidebar (`<ul id="tag-sidebar">`), present on both the post
// list and post details pages in the same shape. Each `<li class="tag-type-*">`
// is one tag; the `<li><h6>…</h6></li>` entries are category headers and are
// skipped. The tag's display name and slug come from the main tag link — the
// only anchor in the item whose href carries a `tags=` query (the `?`, `+`, `-`
// links don't) — and the count from the `.tag-count` span.
export function extractTags(DOM: Document): Tag[] {
    const sidebar = DOM.querySelector("ul#tag-sidebar")
    if (!sidebar) return []

    const tags: Tag[] = []
    for (const li of sidebar.querySelectorAll("li")) {
        const typeMatch = /tag-type-([a-z]+)/.exec(li.className)
        if (!typeMatch) continue

        const type = (KNOWN_TYPES.has(typeMatch[1]) ? typeMatch[1] : "general") as TagType
        const anchor = li.querySelector('a[href*="page=post"][href*="tags="]')
        if (!anchor) continue

        const name = (anchor.textContent ?? "").trim()
        if (name === "") continue

        const href = anchor.getAttribute("href") ?? ""
        const slug = queryParam(href, "tags") ?? name.toLowerCase().replace(/\s+/g, "_")
        const count = parseCount(li.querySelector("span.tag-count")?.textContent ?? "")
        tags.push({ name, slug, type, count })
    }
    return tags
}

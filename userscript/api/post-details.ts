import { fetchDocument } from "./network"
import { type Tag, extractTags } from "./tags"

export type PostDetails = {
    id: number
    title: string
    image: string
    width: number
    height: number
    posted: string
    poster: string
    posterHref: string
    source: string
    sourceHref: string
    rating: string
    score: number
    tags: Tag[]
}

export async function fetchPostDetails(id: number): Promise<PostDetails> {
    const url = `/index.php?page=post&s=view&id=${id}`
    const doc = await fetchDocument(url)
    return extractPostDetails(doc, id)
}

export function extractPostDetails(DOM: Document, id: number): PostDetails {
    const img = DOM.querySelector("img#image")
    const image = img?.getAttribute("src") ?? ""
    const width = Number(img?.getAttribute("width") ?? 0) || 0
    const height = Number(img?.getAttribute("height") ?? 0) || 0

    const title = (DOM.querySelector('input[name="title"]')?.getAttribute("value") ?? "").trim()

    const posterAnchor = statAnchor(DOM, "Posted:")
    const sourceAnchor = statAnchor(DOM, "Source:")
    const rating = statText(DOM, "Rating:")
    const score = parseScore(statText(DOM, "Score:"))

    return {
        id,
        title,
        image,
        width,
        height,
        posted: postedText(DOM),
        poster: posterAnchor?.text ?? "",
        posterHref: posterAnchor?.href ?? "",
        source: sourceAnchor?.text ?? "",
        sourceHref: sourceAnchor?.href ?? "",
        rating,
        score,
        tags: extractTags(DOM),
    }
}

// The <li> in #stats whose text starts with the given label (e.g. "Posted:").
function statLi(DOM: Document, label: string): Element | null {
    const stats = DOM.querySelector("#stats ul")
    if (!stats) return null
    for (const li of stats.querySelectorAll("li")) {
        if ((li.textContent ?? "").trim().startsWith(label)) return li
    }
    return null
}

// The text of a stat li with the leading "Label:" stripped, whitespace collapsed.
function statText(DOM: Document, label: string): string {
    const li = statLi(DOM, label)
    if (!li) return ""
    return (li.textContent ?? "").replace(label, "").replace(/\s+/g, " ").trim()
}

// The first anchor inside a stat li, as { href, text }, or null when absent.
function statAnchor(DOM: Document, label: string): { href: string; text: string } | null {
    const a = statLi(DOM, label)?.querySelector("a")
    if (!a) return null
    return {
        href: a.getAttribute("href") ?? "",
        text: (a.textContent ?? "").replace(/\s+/g, " ").trim(),
    }
}

// "Posted: 2026-07-11 10:28:26 by Tree-Bark" -> "2026-07-11 10:28:26"
function postedText(DOM: Document): string {
    const raw = statText(DOM, "Posted:")
    const byIdx = raw.indexOf(" by ")
    return byIdx === -1 ? raw : raw.slice(0, byIdx)
}

function parseScore(raw: string): number {
    const match = /\d+/.exec(raw)
    return match ? Number(match[0]) : 0
}

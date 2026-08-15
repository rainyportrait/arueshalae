import { fetchDocument } from "./network"
import { type Tag, extractTags } from "./tags"

// The post's main media. Video posts carry a poster thumbnail plus the video
// source; image posts carry just the image. Dimensions come from the "Size:"
// stat, which both kinds provide.
export type PostMedia =
    | { kind: "image"; src: string; width: number; height: number }
    | { kind: "video"; src: string; poster: string; width: number; height: number }

export type PostDetails = {
    id: number
    title: string
    media: PostMedia
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
    const title = (DOM.querySelector('input[name="title"]')?.getAttribute("value") ?? "").trim()

    const posterAnchor = statAnchor(DOM, "Posted:")
    const sourceAnchor = statAnchor(DOM, "Source:")
    const rating = statText(DOM, "Rating:")
    const score = parseScore(statText(DOM, "Score:"))

    return {
        id,
        title,
        media: extractMedia(DOM),
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

// The post's main media element: a <video> for video posts, otherwise the
// <img#image>. Dimensions are read from the "Size:" stat, which both provide.
function extractMedia(DOM: Document): PostMedia {
    const { width, height } = statSize(DOM)
    const video = DOM.querySelector("video#gelcomVideoPlayer")
    if (video) {
        return {
            kind: "video",
            src: video.querySelector("source")?.getAttribute("src") ?? "",
            poster: video.getAttribute("poster") ?? "",
            width,
            height,
        }
    }
    const img = DOM.querySelector("img#image")
    return { kind: "image", src: img?.getAttribute("src") ?? "", width, height }
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

// "Size: 700x874" -> { width: 700, height: 874 }
function statSize(DOM: Document): { width: number; height: number } {
    const match = /(\d+)\s*[x\u00d7]\s*(\d+)/.exec(statText(DOM, "Size:"))
    return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 0, height: 0 }
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

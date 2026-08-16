import { fetchDocument } from "./network.ts"
import { positiveInt, queryParam } from "./parse.ts"
import { type Post, extractPosts } from "./post-list.ts"

export type Favorites = {
    posts: Post[]
    lastPagePID: number
}

export async function fetchFavorites(id: number, pid: number): Promise<Favorites> {
    const url = `/index.php?page=favorites&s=view&id=${id}${pid ? `&pid=${pid}` : ""}`
    const doc = await fetchDocument(url)
    return extractFavorites(doc, pid)
}

// Extract the posts and the last page offset from a favorites page. The posts
// reuse the shared `.thumb` extraction (the per-post anchors carry real
// hrefs, and the "Remove" link sits outside the `.thumb` span, so it is
// skipped automatically).
export function extractFavorites(doc: Document, currentPid: number): Favorites {
    const posts: Post[] = []
    for (const imageList of doc.querySelectorAll(".image-list")) {
        posts.push(...extractPosts(imageList))
    }
    return { posts, lastPagePID: extractLastPagePID(doc, currentPid) }
}

// The favorites paginator renders its links with `href="#"` and an `onclick`
// that assigns `document.location`, so the target URL — and with it the
// `pid` of the last page — lives inside the onclick attribute rather than the
// href. We pull the URL out of the onclick string and read `pid` from it. As
// on the post list, the site omits the last-page link on the last page, so we
// fall back to the pid we requested.
function extractLastPagePID(doc: Document, currentPid: number): number {
    const link = doc.querySelector('a[name="lastpage"]')
    if (!link) return currentPid
    const onclick = link.getAttribute("onclick") ?? ""
    const match = /document\.location\s*=\s*'([^']+)'/u.exec(onclick)
    const pid = match === null ? null : positiveInt(queryParam(match[1], "pid"))
    return pid ?? currentPid
}

import { routeToUrl } from "../router.ts"
import { fetchCleared, fetchDocument } from "./network.ts"
import { positiveInt, queryParam } from "./parse.ts"
import { type Post, collectImageLists } from "./post-list.ts"

export type Favorites = {
    posts: Post[]
    lastPagePID: number
}

export async function fetchFavorites(id: number, pid: number): Promise<Favorites> {
    const url = routeToUrl({ type: "favorites", id, pid })
    const doc = await fetchDocument(url)
    return extractFavorites(doc, pid)
}

// Extract the posts and the last page offset from a favorites page. The posts
// reuse the shared `.thumb` extraction (the per-post anchors carry real
// hrefs, and the "Remove" link sits outside the `.thumb` span, so it is
// skipped automatically).
export function extractFavorites(doc: Document, currentPid: number): Favorites {
    return { posts: collectImageLists(doc), lastPagePID: extractLastPagePID(doc, currentPid) }
}

// --- Mutations ------------------------------------------------------------

// The site's favorite endpoint reports its outcome in the response body:
// "1" means the post is already in the user's favorites, "2" that the visitor
// is not logged in, and anything else that the post was added. We do not
// retry here (unlike the document fetches): the request is a one-shot
// mutation, exactly like the site's own `addFav` XHR.
export type AddFavoriteResult =
    { ok: true } | { ok: false; reason: "already-in-favorites" | "not-logged-in" }

export async function addFavorite(id: number): Promise<AddFavoriteResult> {
    const response = await fetchCleared(`/public/addfav.php?id=${id}`)
    const body = (await response.text()).trim()
    if (body === "1") return { ok: false, reason: "already-in-favorites" }
    if (body === "2") return { ok: false, reason: "not-logged-in" }
    return { ok: true }
}

// Up/downvote a post. The response body is the post's new score (the site
// updates the on-page score element from it directly).
export type VoteDirection = "up" | "down"

export async function votePost(id: number, direction: VoteDirection): Promise<number> {
    const response = await fetchCleared(`/index.php?page=post&s=vote&id=${id}&type=${direction}`)
    const body = (await response.text()).trim()
    const score = Number(body)
    return Number.isFinite(score) ? score : 0
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

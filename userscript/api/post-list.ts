import { fetchDocument } from "./network.ts"
import { positiveInt, queryParam } from "./parse.ts"
import { type Tag, extractTags } from "./tags.ts"

export type Post = {
    id: number
    link: string
    thumbnail: string
}

export type PostList = {
    posts: Post[]
    lastPagePID: number
    tags: Tag[]
}

export async function fetchPostList(tags?: string, pid?: number): Promise<PostList> {
    const url = `/index.php?page=post&s=list${tags ? `&tags=${tags}` : ""}${pid ? `&pid=${pid}` : ""}`
    const doc = await fetchDocument(url)
    const { posts, lastPagePID } = extractPostList(doc, pid ?? 0)
    return { posts, lastPagePID, tags: extractTags(doc) }
}

// Extract the posts from a container of `.thumb` items, sharing one per-thumb
// mapping across the post list and the profile page. Those two pages place the
// post id differently — on the list it is on the `<a>` (`<a id="p…">`), on the
// profile it is on the `<span class="thumb" id="p…">` and the anchor has no id.
// The id is always present in the anchor's href (`…&id=N`), so we read it from
// there: one source of truth for both shapes.
export function extractPosts(container: ParentNode): Post[] {
    const posts: Post[] = []
    for (const thumb of container.querySelectorAll(".thumb")) {
        const anchor = thumb.querySelector("a")
        const img = thumb.querySelector("img")
        if (!anchor || !img) continue

        const link = anchor.getAttribute("href") ?? ""
        const thumbnail = img.getAttribute("src") ?? ""
        posts.push({ id: parsePostIdFromHref(link), link, thumbnail })
    }
    return posts
}

// Read the post id out of a post-view href (`…&id=N`); 0 when absent.
function parsePostIdFromHref(href: string): number {
    return positiveInt(queryParam(href, "id")) ?? 0
}

function extractPostList(
    DOM: Document,
    currentPid: number,
): { posts: Post[]; lastPagePID: number } {
    const posts: Post[] = []
    for (const imageList of DOM.querySelectorAll(".image-list")) {
        posts.push(...extractPosts(imageList))
    }

    const lastPageLink = DOM.querySelector('a[alt="last page"]')
    // The site omits the "last page" link when the current page already is
    // the last page, so in that case (and on a single page, pid=0) fall
    // back to the pid we requested.
    let lastPagePID = currentPid
    if (lastPageLink) {
        const href = lastPageLink.getAttribute("href") ?? ""
        const pid = queryParam(href, "pid")
        const parsed = Number(pid)
        if (pid !== null && Number.isFinite(parsed)) {
            lastPagePID = parsed
        }
    }

    return { posts, lastPagePID }
}

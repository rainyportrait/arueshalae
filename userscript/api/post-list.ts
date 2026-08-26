import { routeToUrl } from "../router.ts"
import { fetchDocument } from "./network.ts"
import { positiveInt, queryParam } from "./parse.ts"
import { type Tag, extractTags, normalizeTags } from "./tags.ts"

export type Post = {
    id: number
    link: string
    thumbnail: string
    // The post's full tag list, parsed from the thumbnail's `alt` text. Empty
    // when the thumb exposes none (e.g. some profile/favorites shapes).
    tags: string[]
}

export type PostList = {
    posts: Post[]
    lastPagePID: number
    tags: Tag[]
}

export async function fetchPostList(tags?: string, pid?: number): Promise<PostList> {
    // The route serializer encodes the query (raw user input with spaces and
    // occasional special characters) so it can't inject or truncate query
    // parameters, and is the single source of truth for the site's URL scheme.
    const url = routeToUrl({ type: "postlist", tags, pid: pid ?? 0 })
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
        posts.push({
            id: parsePostIdFromHref(link),
            link,
            thumbnail,
            tags: parsePostTags(img),
        })
    }
    return posts
}

// Parse the post's full tag list out of the thumbnail's `title` (reliable on
// every surface — on favorites `alt` is a placeholder, "image_thumb"; on the
// post list the list is also mirrored in `alt`). We normalize to match how the
// blacklist is stored, then drop the `:`-bearing metadata tokens the site
// appends (`score:0`, `rating:explicit`, `user:…`).
function parsePostTags(img: Element): string[] {
    return normalizeTags(img.getAttribute("title") ?? "").filter((tag) => !tag.includes(":"))
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
    const pid = lastPageLink
        ? positiveInt(queryParam(lastPageLink.getAttribute("href") ?? "", "pid"))
        : null

    return { posts, lastPagePID: pid ?? currentPid }
}

import { fetchDocument } from "./network"

export type Post = {
    id: number
    link: string
    thumbnail: string
}

export type PostList = {
    posts: Post[]
    lastPagePID: number
}

export async function fetchPostList(tags?: string, pid?: number): Promise<PostList> {
    const url = `/index.php?page=post&s=list${tags ? `&tags=${tags}` : ""}${pid ? `&pid=${pid}` : ""}`
    const doc = await fetchDocument(url)
    return extractPostList(doc, pid ?? 0)
}

function extractPostList(DOM: Document, currentPid: number): PostList {
    const posts: Post[] = []

    for (const thumb of DOM.querySelectorAll(".image-list .thumb")) {
        const anchor = thumb.querySelector("a")
        const img = thumb.querySelector("img")
        if (!anchor || !img) continue

        const anchorId = anchor.getAttribute("id") ?? ""
        const id = Number(anchorId.slice(1))
        const link = anchor.getAttribute("href") ?? ""
        const thumbnail = img.getAttribute("src") ?? ""

        posts.push({ id, link, thumbnail })
    }

    const lastPageLink = DOM.querySelector('a[alt="last page"]')
    // The site omits the "last page" link when the current page already is
    // the last page, so in that case (and on a single page, pid=0) fall
    // back to the pid we requested.
    let lastPagePID = currentPid
    if (lastPageLink) {
        const href = lastPageLink.getAttribute("href") ?? ""
        const pid = parseQueryParam(href, "pid")
        const parsed = Number(pid)
        if (pid !== null && Number.isFinite(parsed)) {
            lastPagePID = parsed
        }
    }

    return { posts, lastPagePID }
}

function parseQueryParam(href: string, key: string): string | null {
    const queryIndex = href.indexOf("?")
    if (queryIndex === -1) return null
    return new URLSearchParams(href.slice(queryIndex + 1)).get(key)
}

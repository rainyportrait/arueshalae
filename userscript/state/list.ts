import van from "vanjs-core"

import { type PostList, extractPostList, fetchPostList } from "../api/post-list.ts"
import { type Tag, extractTags } from "../api/tags.ts"
import { navigate, route } from "../router.ts"
import { type Loadable, routeLoader } from "./load.ts"

// The rule34.xxx post list is paginated 42 posts per page (pid = 42 * (page - 1)).
export const PAGE_SIZE = 42

// The search query is derived from the route: a postlist route carries it
// directly, and a postdetails route carries it as the query the post was
// found under (the site appends it to post links). On any other route it
// falls back to "home" (no tags). `pid` is postlist-only and falls back to 0.
export const tags = van.derive<string | undefined>(() => {
    const r = route.val
    if (r.type === "postlist" || r.type === "postdetails") return r.tags
    return undefined
})
export const pid = van.derive<number>(() => (route.val.type === "postlist" ? route.val.pid : 0))

export type ListReady = {
    posts: PostList["posts"]
    lastPagePID: number
    tags: Tag[]
    // The route parameters this page was loaded with. Pagination and page
    // links are computed from them while the page is on screen — including
    // while the next page loads, when the state still holds this one.
    pid: number
    query: string | undefined
}

export type ListState = Loadable<ListReady>

export const list = van.state<ListState>({ status: "loading" })

export const { pending: listLoading, reload: reloadList } = routeLoader<ListReady, "postlist">(
    list,
    "postlist",
    (r) =>
        fetchPostList(r.tags, r.pid).then((result) => ({
            posts: result.posts,
            lastPagePID: result.lastPagePID,
            tags: result.tags,
            pid: r.pid,
            query: r.tags,
        })),
    // The initial route is a post list: the live document is the server's
    // rendering of exactly this URL, so parse it instead of re-fetching.
    // `null` when the document carries no list container — the bare site
    // root serves a landing page for this route, and a zero-result search
    // omits the container — in which case the page loads from the network.
    (r) => {
        if (!document.querySelector(".image-list")) return null
        const { posts, lastPagePID } = extractPostList(document, r.pid)
        return { posts, lastPagePID, tags: extractTags(document), pid: r.pid, query: r.tags }
    },
)

export function search(newTags: string | undefined): void {
    navigate({ type: "postlist", tags: newTags, pid: 0 })
}

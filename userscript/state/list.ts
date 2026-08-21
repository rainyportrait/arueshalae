import van from "vanjs-core"

import { type PostList, fetchPostList } from "../api/post-list.ts"
import { type Tag } from "../api/tags.ts"
import { navigate, route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

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

// Bumped to force a re-fetch (used by the error state's "Try again" button).
export const reloadTick = van.state(0)

// Read rawVal (not val): this closure runs inside the trigger derive below,
// and a tracked read would make that derive depend on tags/pid, re-running
// (and re-fetching) a second time when they change alongside the route.
const { load: loadList, pending: listLoading } = createLoader<ListReady, void>(list, () =>
    fetchPostList(tags.rawVal, pid.rawVal).then((result) => ({
        posts: result.posts,
        lastPagePID: result.lastPagePID,
        tags: result.tags,
        pid: pid.rawVal,
        query: tags.rawVal,
    })),
)

export { listLoading }

// Re-fetch whenever the route (tags/pid) or reloadTick changes. Gated to
// postlist so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    if (route.val.type !== "postlist") return
    void reloadTick.val
    loadList()
})

export function search(newTags: string | undefined): void {
    navigate({ type: "postlist", tags: newTags, pid: 0 })
}

export function reloadList(): void {
    reloadTick.val += 1
}

import van from "vanjs-core"

import { type PostList, fetchPostList } from "../api/post-list.ts"
import { type Tag } from "../api/tags.ts"
import { navigate, route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

// The rule34.xxx post list is paginated 42 posts per page (pid = 42 * (page - 1)).
export const PAGE_SIZE = 42

// The list query is derived from the route: only a postlist route carries
// tags/pid. On any other route these fall back to "home" (no tags, page 0).
export const tags = van.derive<string | undefined>(() =>
    route.val.type === "postlist" ? route.val.tags : undefined,
)
export const pid = van.derive<number>(() => (route.val.type === "postlist" ? route.val.pid : 0))

type ListReady = {
    posts: PostList["posts"]
    lastPagePID: number
    tags: Tag[]
}

export type ListState = Loadable<ListReady>

export const list = van.state<ListState>({ status: "loading" })

// Bumped to force a re-fetch (used by the error state's "Try again" button).
export const reloadTick = van.state(0)

const loadList = createLoader<ListReady, void>(list, () =>
    fetchPostList(tags.val, pid.val).then((result) => ({
        posts: result.posts,
        lastPagePID: result.lastPagePID,
        tags: result.tags,
    })),
)

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

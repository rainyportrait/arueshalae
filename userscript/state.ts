import van from "vanjs-core/src/van"

import { type PostDetails, fetchPostDetails } from "./api/post-details"
import { type PostList, fetchPostList } from "./api/post-list"
import type { Tag } from "./api/tags"
import { navigate, route } from "./router"

// The rule34.xxx post list is paginated 42 posts per page (pid = 42 * (page - 1)).
export const PAGE_SIZE = 42

// The list query is derived from the route: only a postlist route carries
// tags/pid. On any other route these fall back to "home" (no tags, page 0).
export const tags = van.derive<string | undefined>(() =>
    route.val.type === "postlist" ? route.val.tags : undefined,
)
export const pid = van.derive<number>(() => (route.val.type === "postlist" ? route.val.pid : 0))

export type ListState =
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; posts: PostList["posts"]; lastPagePID: number; tags: Tag[] }

export const list = van.state<ListState>({ status: "loading" })

// Bumped to force a re-fetch (used by the error state's "Try again" button).
export const reloadTick = van.state(0)

let requestSeq = 0

function loadList(currentTags: string | undefined, currentPid: number): void {
    const seq = ++requestSeq
    list.val = { status: "loading" }

    fetchPostList(currentTags, currentPid)
        .then((result) => {
            if (seq !== requestSeq) return
            list.val = {
                status: "ready",
                posts: result.posts,
                lastPagePID: result.lastPagePID,
                tags: result.tags,
            }
        })
        .catch((error: unknown) => {
            if (seq !== requestSeq) return
            list.val = {
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            }
        })
}

// Re-fetch whenever the route (tags/pid) or reloadTick changes. Gated to
// postlist so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    if (route.val.type !== "postlist") return
    const currentTags = tags.val
    const currentPid = pid.val
    const tick = reloadTick.val
    void tick
    loadList(currentTags, currentPid)
})

export function search(newTags: string | undefined): void {
    navigate({ type: "postlist", tags: newTags, pid: 0 })
}

export function reloadList(): void {
    reloadTick.val += 1
}

// --- Post details ---------------------------------------------------------

export type DetailsState =
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; post: PostDetails }

export const details = van.state<DetailsState>({ status: "loading" })

// Bumped to force a details re-fetch (used by the error state's "Try again").
const detailsTick = van.state(0)
let detailsSeq = 0

function loadDetails(id: number): void {
    const seq = ++detailsSeq
    details.val = { status: "loading" }

    fetchPostDetails(id)
        .then((post) => {
            if (seq !== detailsSeq) return
            details.val = { status: "ready", post }
        })
        .catch((error: unknown) => {
            if (seq !== detailsSeq) return
            details.val = {
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            }
        })
}

// Re-fetch whenever the postdetails route or detailsTick changes. Gated to
// postdetails so we don't fire a wasted fetch while sitting on another route.
van.derive(() => {
    const r = route.val
    if (r.type !== "postdetails") return
    void detailsTick.val
    loadDetails(r.id)
})

export function reloadDetails(): void {
    detailsTick.val += 1
}

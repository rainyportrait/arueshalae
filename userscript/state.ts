import van from "vanjs-core/src/van"

import { type PostList, fetchPostList } from "./api/post-list"

// The rule34.xxx post list is paginated 42 posts per page (pid = 42 * (page - 1)).
export const PAGE_SIZE = 42

// Seed the query from the URL so the app respects the page it is injected into
// (e.g. ?page=post&s=list&tags=blonde_hair&pid=42).
function readInitialQuery(): { tags: string | undefined; pid: number | undefined } {
    const params = new URLSearchParams(window.location.search)
    const tagsParam = params.get("tags")
    const pidParam = params.get("pid")
    const pidNum = pidParam === null ? NaN : Number(pidParam)
    return {
        tags: tagsParam ?? undefined,
        pid: pidParam !== null && Number.isFinite(pidNum) ? pidNum : undefined,
    }
}

const initial = readInitialQuery()

export const tags = van.state<string | undefined>(initial.tags)
export const pid = van.state<number | undefined>(initial.pid)

export type ListState =
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; posts: PostList["posts"]; lastPagePID: number }

export const list = van.state<ListState>({ status: "loading" })

// Bumped to force a re-fetch (used by the error state's "Try again" button).
export const reloadTick = van.state(0)

let requestSeq = 0

function loadList(currentTags: string | undefined, currentPid: number | undefined): void {
    const seq = ++requestSeq
    list.val = { status: "loading" }

    fetchPostList(currentTags, currentPid)
        .then((result) => {
            if (seq !== requestSeq) return
            list.val = {
                status: "ready",
                posts: result.posts,
                lastPagePID: result.lastPagePID,
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

// Re-fetch whenever the query (tags) or the page (pid) changes. Reading the
// states inside the derive registers them as dependencies.
van.derive(() => {
    const currentTags = tags.val
    const currentPid = pid.val
    const tick = reloadTick.val
    void tick
    loadList(currentTags, currentPid)
})

export function search(newTags: string | undefined): void {
    tags.val = newTags
    pid.val = undefined
}

export function goToPage(page: number): void {
    pid.val = (page - 1) * PAGE_SIZE
}

export function reloadList(): void {
    reloadTick.val += 1
}

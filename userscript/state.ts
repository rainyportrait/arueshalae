import van from "vanjs-core/src/van"

import {
    type UserProfile,
    login as apiLogin,
    fetchUserProfile,
    parseUserIdFromAccountHome,
} from "./api/auth"
import { fetchDocument } from "./api/network"
import { type PostDetails, fetchPostDetails } from "./api/post-details"
import { type PostList, fetchPostList } from "./api/post-list"
import type { Tag } from "./api/tags"
import { navigate, returnTo, route } from "./router"

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

// --- Auth -----------------------------------------------------------------

// Are we logged in, and if so who (by id)? `userId` is the signal that
// establishes authentication; nothing else lives here.
export type AuthState =
    | { status: "unknown" } // before init has checked
    | { status: "guest" } // not logged in
    | { status: "authenticated"; userId: number }

export const auth = van.state<AuthState>({ status: "unknown" })

// The enriched profile data, which presupposes authentication. Follows the same
// discriminated-union pattern as the post list/details state.
export type UserInfoState =
    | { status: "idle" } // not authenticated
    | { status: "loading" } // authenticated, fetching
    | { status: "error"; error: string }
    | { status: "ready"; profile: UserProfile }

export const userInfo = van.state<UserInfoState>({ status: "idle" })

// Establish auth on init: fetch the account home page and detect the logged-in
// user id by positive match. A failure leaves us as guest (the app still works
// for anonymous browsing).
fetchDocument("/index.php?page=account&s=home")
    .then((doc) => {
        const userId = parseUserIdFromAccountHome(doc)
        auth.val = userId === null ? { status: "guest" } : { status: "authenticated", userId }
    })
    .catch(() => {
        auth.val = { status: "guest" }
    })

// Once authenticated, fetch the profile (username, favorites count, ...) and
// hold it in `userInfo`. Fires once per authenticated user: guarded so it
// doesn't re-fetch while loading or already ready, and doesn't auto-retry an
// error (the menu stays functional off `userId` alone).
let profileSeq = 0
function loadProfile(userId: number): void {
    const seq = ++profileSeq
    userInfo.val = { status: "loading" }
    fetchUserProfile(userId)
        .then((profile) => {
            if (seq !== profileSeq) return
            userInfo.val = { status: "ready", profile }
        })
        .catch((error: unknown) => {
            if (seq !== profileSeq) return
            userInfo.val = {
                status: "error",
                error: error instanceof Error ? error.message : String(error),
            }
        })
}

van.derive(() => {
    const a = auth.val
    if (a.status !== "authenticated") {
        if (userInfo.val.status !== "idle") userInfo.val = { status: "idle" }
        return
    }
    if (userInfo.val.status === "idle") loadProfile(a.userId)
})

// --- Login / logout -------------------------------------------------------

export type LoginOutcome = { ok: true } | { ok: false; error: string }

// Submit credentials. On success we mark the user authenticated (which triggers
// the single profile fetch above) and return to the route we came from. On
// failure we surface the site's error (or a generic one).
export async function login(username: string, password: string): Promise<LoginOutcome> {
    const result = await apiLogin(username, password)
    if (result.ok) {
        auth.val = { status: "authenticated", userId: result.userId }
        const dest = returnTo.val ?? { type: "postlist", tags: undefined, pid: 0 }
        returnTo.val = null
        navigate(dest)
        return { ok: true }
    }
    return { ok: false, error: result.error }
}

// Log out: fire the request (the server clears the session cookie) and reset
// both states regardless of the result — the user's intent is unambiguous, and
// a flaky network call shouldn't leave them "stuck logged in" in the UI.
export function logout(): void {
    void fetch("/index.php?page=account&s=login&code=01").catch(() => {})
    auth.val = { status: "guest" }
    userInfo.val = { status: "idle" }
}

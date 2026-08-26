import van from "vanjs-core"

import {
    type UserProfile,
    login as apiLogin,
    fetchProfile,
    parseUserIdFromCookie,
} from "../api/auth.ts"
import { navigate, redirect, returnTo, route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

// Are we logged in, and if so who (by id)? `userId` is the signal that
// establishes authentication; nothing else lives here.
export type AuthState =
    | { status: "guest" } // not logged in
    | { status: "authenticated"; userId: number }

// The site sets a JavaScript-readable `user_id` cookie on login (it lives and
// dies with the session), so the auth state is known synchronously from the
// cookie — no request needed.
function authFromCookie(): AuthState {
    const userId = parseUserIdFromCookie(document.cookie)
    return userId === null ? { status: "guest" } : { status: "authenticated", userId }
}

export const auth = van.state<AuthState>(authFromCookie())

// The login route is only meaningful for guests. An authenticated user can
// still land on it — typed URL, or back/forward onto a pre-login history
// entry — so bounce them to the post list. The bounce replaces (not pushes)
// the URL, so back/forward cannot ping-pong between the two.
van.derive(() => {
    if (auth.val.status === "authenticated" && route.val.type === "login") {
        redirect({ type: "postlist", tags: undefined, pid: 0 })
    }
})

// The enriched profile data, which presupposes authentication. Follows the same
// discriminated-union pattern as the post list/details state, with an "idle"
// status while not authenticated.
export type UserInfoState = Loadable<{ profile: UserProfile }, { status: "idle" }>

export const userInfo = van.state<UserInfoState>({ status: "idle" })

// Once authenticated, fetch the profile (username, favorites count, ...) and
// hold it in `userInfo`. Fires once per authenticated user: guarded so it
// doesn't re-fetch while loading or already ready, and doesn't auto-retry an
// error (the menu stays functional off `userId` alone).
const { load: loadProfile, pending: userInfoLoading } = createLoader(userInfo, (userId: number) =>
    fetchProfile({ id: userId }).then((profile) => ({ profile })),
)

export { userInfoLoading }

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
        // Leave the login route *before* marking the user authenticated: the
        // login-route guard above runs synchronously on the auth change and
        // would otherwise rewrite the login history entry a tick before this
        // navigation, so "back" would land on the post list instead of the
        // pre-login route.
        const dest = returnTo.val ?? { type: "postlist", tags: undefined, pid: 0 }
        returnTo.val = null
        navigate(dest)
        auth.val = { status: "authenticated", userId: result.userId }
        return { ok: true }
    }
    return { ok: false, error: result.error }
}

// Log out by deleting the session cookies: the server keys the session on
// them, so once they are gone the user is anonymous and no network round-trip
// is needed (and none can fail or trip the rate limiter). Both cookies are
// JavaScript-readable; expiry in the past makes the browser drop them.
export function logout(): void {
    for (const name of ["user_id", "pass_hash"]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
    auth.val = { status: "guest" }
    userInfo.val = { status: "idle" }
}

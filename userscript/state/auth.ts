import van from "vanjs-core"

import {
    type UserProfile,
    login as apiLogin,
    fetchUserProfile,
    parseUserIdFromAccountHome,
} from "../api/auth.ts"
import { fetchDocument } from "../api/network.ts"
import { navigate, returnTo } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

// Are we logged in, and if so who (by id)? `userId` is the signal that
// establishes authentication; nothing else lives here.
export type AuthState =
    | { status: "unknown" } // before init has checked
    | { status: "guest" } // not logged in
    | { status: "authenticated"; userId: number }

export const auth = van.state<AuthState>({ status: "unknown" })

// The enriched profile data, which presupposes authentication. Follows the same
// discriminated-union pattern as the post list/details state, with an "idle"
// status while not authenticated.
export type UserInfoState = Loadable<{ profile: UserProfile }, { status: "idle" }>

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
const loadProfile = createLoader(userInfo, (userId: number) =>
    fetchUserProfile(userId).then((profile) => ({ profile })),
)

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

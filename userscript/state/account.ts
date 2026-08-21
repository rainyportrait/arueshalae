import van from "vanjs-core"

import { type ProfileRef, type UserProfile, fetchProfile } from "../api/auth.ts"
import { route } from "../router.ts"
import { type Loadable, createLoader } from "./load.ts"

// The profile for the account on the account route. The user is addressed by
// id or by username (whichever the URL carried); the site resolves both.
export const profile = van.state<Loadable<UserProfile>>({ status: "loading" })

// Bumped to force a re-fetch (used by the error state's "Try again" button).
const reloadTick = van.state(0)

const { load: loadProfile, pending: profileLoading } = createLoader<UserProfile, ProfileRef>(
    profile,
    fetchProfile,
)

export { profileLoading }

// Fetch whenever the account route (ref) or reloadTick changes. Gated to the
// account route so we don't fire a wasted fetch while sitting on another
// route; reading only `route.val` keeps the derive from re-running a second
// time when the derived ref changes alongside it.
van.derive(() => {
    const r = route.val
    if (r.type !== "account") return
    void reloadTick.val
    loadProfile("uname" in r ? { uname: r.uname } : { id: r.id })
})

export function reloadProfile(): void {
    reloadTick.val += 1
}

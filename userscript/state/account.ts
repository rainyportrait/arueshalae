import van from "vanjs-core"

import { type UserProfile, fetchProfile } from "../api/auth.ts"
import { route } from "../router.ts"
import { type Loadable, routeLoader } from "./load.ts"

// The profile for the account on the account route. The user is addressed by
// id or by username (whichever the URL carried); the site resolves both.
export const profile = van.state<Loadable<UserProfile>>({ status: "loading" })

export const { pending: profileLoading, reload: reloadProfile } = routeLoader<
    UserProfile,
    "account"
>(profile, "account", (r) => fetchProfile("uname" in r ? { uname: r.uname } : { id: r.id }))

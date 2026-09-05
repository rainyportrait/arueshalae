import van from "vanjs-core"

import { profileLoading } from "./account.ts"
import { userInfoLoading } from "./auth.ts"
import { detailsLoading } from "./details.ts"
import { favoritesLoading } from "./favorites.ts"
import { listLoading } from "./list.ts"

// True while a data fetch is in flight. Driven by the loaders' pending states
// (not the data states, which keep their old value until the fetch settles),
// so the bar shows during a load without the page re-rendering. Pages keep
// showing their previous data during a navigation, so this is what tells the
// user something is in flight — it drives the bar at the top of the app.
export const pageLoading = van.derive(
    () =>
        listLoading.val ||
        detailsLoading.val ||
        favoritesLoading.val ||
        profileLoading.val ||
        userInfoLoading.val,
)

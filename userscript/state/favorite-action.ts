import type { State } from "vanjs-core"

import { addFavorite } from "../api/favorites.ts"

// The favorite button's lifecycle for the currently shown post: available,
// in flight, or settled into one of the two disabled end states.
export type FavoriteStatus = "idle" | "adding" | "added" | "already"

// Keep the network lifecycle separate from the button markup so stale
// completions can be tested directly. The caller supplies an identity check
// for the post that started the request; navigation may reuse the same state
// object for another post while this request is in flight.
export async function addFavoriteWithStatus(
    postId: number,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    add: typeof addFavorite = addFavorite,
): Promise<void> {
    favorite.val = "adding"
    try {
        const result = await add(postId)
        if (!isCurrent()) return
        if (result.ok) favorite.val = "added"
        else if (result.reason === "already-in-favorites") favorite.val = "already"
        else favorite.val = "idle" // not logged in (stale session)
    } catch {
        if (isCurrent()) favorite.val = "idle" // network error; keep it retryable
    }
}

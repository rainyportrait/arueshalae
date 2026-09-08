import van, { type State } from "vanjs-core"

import { sessionAlive } from "../api/auth.ts"
import {
    type AddFavoriteResult,
    type RemoveFavoriteResult,
    addFavorite,
    removeFavorite,
} from "../api/favorites.ts"
import type { PostDetails } from "../api/post-details.ts"
import { setFavoriteMembership } from "../api/sync.ts"
import { downloadKnownPost } from "../sync/download.ts"
import { auth } from "./auth.ts"
import { refreshLibrary } from "./library.ts"
import { serverSettings } from "./settings.ts"

// The button mutates rule34 first, then mirrors the acknowledged membership to
// the local server. "library-failed" and "removal-failed" mean the upstream
// mutation succeeded but its membership write did not, so retries only repeat
// the local write. Media downloads belong to the persistent queue and are not
// part of this state machine.
export type FavoriteStatus =
    | "idle"
    | "adding"
    | "saving"
    | "added"
    | "already"
    | "library-failed"
    | "removing"
    | "removal-failed"
    | "stale-session"

type MembershipWriter = (post: PostDetails) => Promise<void>
type UnfavoriteWriter = (postId: number) => Promise<void>
type SessionCheck = (userId: number) => Promise<boolean>

const productionFavorite: MembershipWriter = async (post) => {
    await setFavoriteMembership(post.id, true)
    await downloadKnownPost(post).catch(() => {})
}
const productionUnfavorite: UnfavoriteWriter = (postId) => setFavoriteMembership(postId, false)
const productionSessionCheck: SessionCheck = (userId) =>
    userId > 0 ? sessionAlive(userId) : Promise.resolve(false)

// Membership writes are serialized so rapid favorite actions preserve their
// prepend order. The public map also lets a remounted details page join
// an in-flight write instead of offering a duplicate action.
export const membershipWrites = van.state<Map<number, Promise<boolean>>>(new Map())

let membershipWriteChain: Promise<void> = Promise.resolve()

function startMembershipWrite(post: PostDetails, write: MembershipWriter): Promise<boolean> {
    const existing = membershipWrites.rawVal.get(post.id)
    if (existing !== undefined) return existing

    // Resolve failures to false: the button owns retry presentation, and no
    // rejected background promise should escape after its caller unmounts.
    const run = membershipWriteChain.then(async (): Promise<boolean> => {
        try {
            await write(post)
            void refreshLibrary([post.id]).catch(() => {})
            return true
        } catch {
            return false
        }
    })
    const task = run.finally(() => setMembershipWrite(post.id, undefined))

    setMembershipWrite(post.id, task)
    membershipWriteChain = task.then(() => undefined)
    return task
}

function setMembershipWrite(postId: number, task: Promise<boolean> | undefined): void {
    const next = new Map(membershipWrites.rawVal)
    if (task === undefined) next.delete(postId)
    else next.set(postId, task)
    membershipWrites.val = next
}

// The caller supplies an identity check because navigation may reuse the same
// state object for another post while either request is in flight.
export async function addFavoriteWithStatus(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    add: typeof addFavorite = addFavorite,
    write: MembershipWriter = productionFavorite,
): Promise<void> {
    favorite.val = "adding"

    let result: AddFavoriteResult
    try {
        result = await add(post.id)
    } catch {
        if (isCurrent()) favorite.val = "idle"
        return
    }
    if (!isCurrent()) return

    if (!result.ok && result.reason === "not-logged-in") {
        favorite.val = "idle"
        return
    }

    const endState: FavoriteStatus = result.ok ? "added" : "already"
    if (!serverSettings.rawVal.enabled) {
        favorite.val = endState
        return
    }

    favorite.val = "saving"
    const saved = await startMembershipWrite(post, write)
    if (isCurrent()) favorite.val = saved ? endState : "library-failed"
}

// Rule34 already holds this favorite; retry only the membership write.
export async function retryFavoriteMembership(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    write: MembershipWriter = productionFavorite,
): Promise<void> {
    if (!serverSettings.rawVal.enabled) {
        favorite.val = "already"
        return
    }

    favorite.val = "saving"
    const saved = await startMembershipWrite(post, write)
    if (isCurrent()) favorite.val = saved ? "already" : "library-failed"
}

// A removal failure is ambiguous: rule34 uses the same response when a post is
// already absent and when the session expired. Only an authenticated session
// lets us safely mirror the post as unfavorited locally.
export async function removeFavoriteWithStatus(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    remove: (postId: number) => Promise<RemoveFavoriteResult> = removeFavorite,
    checkSession: SessionCheck = productionSessionCheck,
    unfavorite: UnfavoriteWriter = productionUnfavorite,
): Promise<void> {
    const previousState = favorite.val
    favorite.val = "removing"

    let result: RemoveFavoriteResult
    try {
        result = await remove(post.id)
    } catch {
        if (isCurrent()) favorite.val = previousState
        return
    }
    if (!isCurrent()) return

    if (!result.ok) {
        const account = auth.rawVal
        const userId = account.status === "authenticated" ? account.userId : 0

        let sessionIsAlive: boolean
        try {
            sessionIsAlive = await checkSession(userId)
        } catch {
            // The failed check leaves the upstream result unresolved. Keep the
            // original button face and do not touch local membership.
            if (isCurrent()) favorite.val = previousState
            return
        }
        if (!isCurrent()) return

        if (!sessionIsAlive) {
            favorite.val = "stale-session"
            return
        }
    }

    await retryUnfavoriteMembership(post, favorite, isCurrent, unfavorite)
}

// Rule34 already dropped this favorite; retry only the membership write. Any
// downloaded media is deliberately retained by the server.
export async function retryUnfavoriteMembership(
    post: PostDetails,
    favorite: State<FavoriteStatus>,
    isCurrent: () => boolean,
    unfavorite: UnfavoriteWriter = productionUnfavorite,
): Promise<void> {
    if (!serverSettings.rawVal.enabled) {
        if (isCurrent()) favorite.val = "idle"
        return
    }

    favorite.val = "removing"
    try {
        await unfavorite(post.id)
    } catch {
        if (isCurrent()) favorite.val = "removal-failed"
        return
    }

    await refreshLibrary([post.id]).catch(() => {})
    if (isCurrent()) favorite.val = "idle"
}

import van from "vanjs-core"

import { checkDownloads } from "../api/server.ts"
import { auth } from "./auth.ts"
import { details } from "./details.ts"
import { favorites } from "./favorites.ts"
import { list } from "./list.ts"
import { serverSettings } from "./settings.ts"

// The post ids the server reports holding, learned from /api/posts/downloaded
// responses.
// Session-only (never persisted): the server's database only grows while a
// session is alive, so an id in the set stays true for the whole session.
// The UI gates its badges/buttons on this set *and* on `serverSettings`, so
// disabling the server hides all library state immediately; re-enabling
// restores it from memory without a new request.
export const downloaded = van.state<Set<number>>(new Set())

// The ids /api/posts/downloaded already answered for this session, downloaded
// or not.
// Plain storage (not state): a back/forward replay republishes the same page,
// and the ids it carries must not be re-queried. An id only lands here once
// a check has *succeeded* — a failed check leaves its ids unanswered so the
// next settle retries them (the server may have come back).
const answered = new Set<number>()

// Fold a /api/posts/downloaded result into the shared set. A no-op (no state
// write) when
// nothing new arrived, so an all-absent response never re-renders the grid.
export function markDownloaded(ids: Iterable<number>): void {
    const current = downloaded.val
    let changed = false
    const next = new Set(current)
    for (const id of ids) {
        if (!current.has(id)) {
            next.add(id)
            changed = true
        }
    }
    if (changed) downloaded.val = next
}

// Drop an id from the shared set (its library copy was deleted). A no-op
// (no state write) when absent, mirroring markDownloaded. `answered`
// deliberately keeps the id: no later settle re-queries it this session, so
// the removal is sticky (re-favoriting + re-saving re-adds the id via
// markDownloaded).
export function unmarkDownloaded(id: number): void {
    const current = downloaded.val
    if (!current.has(id)) return
    const next = new Set(current)
    next.delete(id)
    downloaded.val = next
}

// Ask the server about a batch of post ids and fold the result into the
// shared set. Already-answered ids are not re-queried; a failure (server
// down, timeout, bad URL) is dropped silently — the badges simply stay
// hidden. `check` is injectable for tests.
export function checkDownloadsPage(
    ids: number[],
    check: (postIds: number[]) => Promise<Set<number>> = checkDownloads,
): void {
    const unknown = ids.filter((id) => !answered.has(id))
    if (unknown.length === 0) return
    void check(unknown).then(
        (result) => {
            for (const id of unknown) answered.add(id)
            markDownloaded(result)
        },
        () => {
            /* non-fatal: the badges stay hidden and a later settle retries */
        },
    )
}

// Whether the given favorites page belongs to the logged-in user. On that
// page the server (mirroring *our* downloads) would badge essentially every
// card, so the badges are noise there: the check is skipped and the cards
// hide them (PostCard re-checks this live).
function isOwnFavorites(id: number): boolean {
    const a = auth.val
    return a.status === "authenticated" && a.userId === id
}

// Check a grid page as soon as it settles (and re-check the current one when
// the server is enabled mid-session). Reads the list and favorites payloads
// directly, so this re-runs exactly when a page settles or the server/auth
// settings change — never on grid-local re-renders (blacklist toggle, ...).
// The favorites payload is read only while ready, so its ids are checked once
// per settled page (the answered set absorbs the replay republishes).
van.derive(() => {
    if (!serverSettings.val.enabled) return
    const l = list.val
    if (l.status === "ready") checkDownloadsPage(l.posts.map((p) => p.id))
    const f = favorites.val
    if (f.status === "ready" && !isOwnFavorites(f.id)) checkDownloadsPage(f.posts.map((p) => p.id))
})

// The details page checks its single post as it settles — guests included,
// since the result feeds the shared set the grid badges read later. The
// favorite button reads the set live, so the check never touches its state.
van.derive(() => {
    if (!serverSettings.val.enabled) return
    const d = details.val
    if (d.status === "ready") checkDownloadsPage([d.post.id])
})

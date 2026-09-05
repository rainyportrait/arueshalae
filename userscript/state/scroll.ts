import van from "vanjs-core"

// Per-history-entry window scroll memory, so back/forward restores where the
// user was. The browser keeps no scroll position for History API
// navigations: the document stays up and popstate just leaves the offset
// clamped to the arriving page's height. So we remember one offset per
// entry, keyed by a token stamped into history.state — the one per-entry
// value the browser restores for us. A token rather than a history.length
// index, because an unrelated pushState can shift indices without
// invalidating state; entries that carry no token (a full page load of the
// old UI, another script's push) get one on first arrival and simply have no
// remembered offset until the user scrolls.
//
// The current offset is remembered continuously (the app's gated scroll
// listener calls rememberScroll) and snapshotted before every push, so a
// click can never lose the last frame's scroll. Back/forward publishes the
// arriving entry's offset to scrollRestore; the app applies it once that
// page is actually on screen (App.ts), since the visible page lags the route
// until its data settles or replays.

const KEY = "arue-scroll"
const positions = new Map<number, number>()
let seq = 0
let current: number | undefined

const rawReplace = window.history.replaceState.bind(window.history)

// (Re)stamp the entry under the URL: adopt the token its state already
// carries, or mint one and write it back, merging any existing state object
// (other extensions' keys survive).
function stamp(): number {
    const state = window.history.state
    const existing: Record<string, unknown> =
        state !== null && typeof state === "object" ? { ...(state as Record<string, unknown>) } : {}
    const token = typeof existing[KEY] === "number" ? (existing[KEY] as number) : ++seq
    if (token !== (existing[KEY] as number)) rawReplace({ ...existing, [KEY]: token }, "")
    return token
}

current = stamp()

// The offset a back/forward wants the page restored to; null while nothing
// is pending. A navigation (push or replace) supersedes it.
export const scrollRestore = van.state<number | null>(null)

// Record the current window offset under the current entry.
export function rememberScroll(): void {
    if (current !== undefined) positions.set(current, window.scrollY)
}

// Consume the pending restore and scroll to it. The scroll is deferred to
// a requestAnimationFrame: the page swap the route change triggers happens
// in this same van update pass, after the derives that call this, but the
// new page's layout only exists when the frame's layout pass runs — a
// microtask still scrolls against the outgoing page's height (the offset
// clamps to zero on a shorter page), while an rAF callback runs after
// layout and before paint, so the restore lands in the very frame the page
// swaps: no visible wrong offset. A navigation in the meantime moves
// `current`, which voids a restore that is no longer for the current entry.
export function applyRestore(): void {
    const y = scrollRestore.val
    if (y === null) return
    scrollRestore.val = null
    const entry = current
    requestAnimationFrame(() => {
        if (entry !== undefined && entry === current) window.scrollTo(0, y)
    })
}

// push/replace are the only door an entry can be entered through (popstate
// has its own listener below), so wrapping them keeps the memory in sync
// without the router knowing about scroll. The flag lives on the history
// object so a re-import (tests reset the module graph) doesn't wrap twice.
const history = window.history as History & { __arueScroll?: boolean }
if (!history.__arueScroll) {
    history.__arueScroll = true
    const rawPush = window.history.pushState.bind(window.history)
    const enter = () => {
        current = stamp()
        positions.set(current, window.scrollY) // an entry starts where we are
        scrollRestore.val = null // a navigation supersedes any pending restore
    }
    window.history.pushState = (data: unknown, title: string, url?: string | URL | null) => {
        rememberScroll() // the outgoing entry's final offset, before it's pushed away
        rawPush(data, title, url)
        enter()
    }
    window.history.replaceState = (data: unknown, title: string, url?: string | URL | null) => {
        rawReplace(data, title, url)
        enter()
    }
}

window.addEventListener("popstate", () => {
    current = stamp()
    scrollRestore.val = positions.get(current) ?? null
})

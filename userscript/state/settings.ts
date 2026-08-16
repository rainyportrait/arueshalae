import van from "vanjs-core"

import type { Post } from "../api/post-list.ts"

// Settings are persisted to localStorage under an `arue-` prefix so they can't
// collide with anything rule34.xxx itself stores. The site doesn't require login
// for the settings page, and neither do we — the values are per-browser, not
// per-account.
const PREFIX = "arue-"

// Read a JSON value from localStorage, tolerating absence and corruption.
function readJSON<T>(key: string, fallback: T): T {
    try {
        const raw = localStorage.getItem(key)
        return raw === null ? fallback : (JSON.parse(raw) as T)
    } catch {
        return fallback
    }
}

// Persist a value as JSON. Failures (quota, private mode) are swallowed: the
// setting simply won't survive a reload, but the session still works.
function writeJSON(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value))
    } catch {
        /* non-fatal: settings just won't persist */
    }
}

// --- Tag blacklist --------------------------------------------------------
// A list of tags; any postlist post carrying one of these is hidden. Applied
// only to the post list, never to favorites or other post surfaces.

export const tagBlacklist = van.state<string[]>(readJSON<string[]>(`${PREFIX}tag-blacklist`, []))

export function setTagBlacklist(tags: string[]): void {
    tagBlacklist.val = tags
    writeJSON(`${PREFIX}tag-blacklist`, tags)
}

// --- Image quality --------------------------------------------------------
// When true, the post details page loads the original image right away instead
// of the sample.

export const preferOriginal = van.state<boolean>(
    readJSON<boolean>(`${PREFIX}prefer-original`, false),
)

export function setPreferOriginal(value: boolean): void {
    preferOriginal.val = value
    writeJSON(`${PREFIX}prefer-original`, value)
}

// --- Hidden posts toggle --------------------------------------------------
// Whether blacklisted posts are currently shown in the post list. Session-only
// (not persisted): it is a viewing preference for the current list, not a
// stored setting.

export const showHiddenPosts = van.state(false)

// Split a list of posts into those that match the blacklist (hidden) and those
// that don't (visible). With an empty blacklist everything is visible. A post
// is hidden if it carries *any* blacklisted tag.
export function filterByBlacklist(
    posts: Post[],
    blacklist: string[],
): { visible: Post[]; hidden: Post[] } {
    if (blacklist.length === 0) return { visible: posts, hidden: [] }
    const set = new Set(blacklist)
    const visible: Post[] = []
    const hidden: Post[] = []
    for (const post of posts) {
        if (post.tags.some((tag) => set.has(tag))) hidden.push(post)
        else visible.push(post)
    }
    return { visible, hidden }
}

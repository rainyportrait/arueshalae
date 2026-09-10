import van from "vanjs-core"
import type { State } from "vanjs-core"

import type { Post } from "../api/post-list.ts"

// Settings are persisted to localStorage under an `arue-` prefix so they can't
// collide with anything rule34.xxx itself stores. The site doesn't require login
// for the settings page, and neither do we — the values are per-browser, not
// per-account.
const PREFIX = "arue-"

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

// A van state backed by localStorage: read once at init, and every write
// persists (a failed write just doesn't persist). Assignments and reactivity
// behave exactly like a plain state — the wrapper's accessors proxy the inner
// state, so derives that read it subscribe to the real state.
function persisted<T>(key: string, fallback: T): State<T> {
    const s = van.state<T>(readJSON(key, fallback))
    return {
        get val() {
            return s.val
        },
        set val(v) {
            s.val = v
            writeJSON(key, v)
        },
        get oldVal() {
            return s.oldVal
        },
        get rawVal() {
            return s.rawVal
        },
    }
}

// --- Tag blacklist --------------------------------------------------------
// A list of tags; any postlist post carrying one of these is hidden. Applied
// only to the post list, never to favorites or other post surfaces.

export const tagBlacklist = persisted<string[]>(`${PREFIX}tag-blacklist`, [])

// --- Image quality --------------------------------------------------------
// When true, the post details page loads the original image right away instead
// of the sample.

export const preferOriginal = persisted<boolean>(`${PREFIX}prefer-original`, false)

// --- Hidden posts toggle --------------------------------------------------
// Whether blacklisted posts are currently shown in the post list. Session-only
// (not persisted): it is a viewing preference for the current list, not a
// stored setting.

export const showHiddenPosts = van.state(false)

// --- Arueshalae server ------------------------------------------------------
// Connection to the arueshalae media server (the `server/` crate). The URL is
// where the server listens (its `--host`/`--port` flags); while disabled the
// userscript never talks to it.

export interface ServerSettings {
    enabled: boolean
    url: string
    // Optional only for compatibility with settings persisted by older builds.
    preferDownloaded?: boolean
    useCachedPostDetails?: boolean
}

export const serverSettings = persisted<ServerSettings>(`${PREFIX}server`, {
    enabled: false,
    url: "http://127.0.0.1:34343",
    preferDownloaded: true,
    useCachedPostDetails: true,
})

// A post is hidden if it carries *any* blacklisted tag; with an empty
// blacklist everything is visible.
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

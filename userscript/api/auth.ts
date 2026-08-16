import { fetchDocument } from "./network.ts"
import { parseCount, positiveInt, queryParam } from "./parse.ts"
import { type Post, extractPosts } from "./post-list.ts"

// A user's profile view: their stats and recent activity. The profile page
// (`page=favorites&s=view&id=N`) shows any user `N`, so the logged-in user's
// info and a future profile page share this one shape and parser.
export type UserProfile = {
    id: number // numeric id from the profile page's favorites link; 0 when absent
    username: string // the first <h2> inside #content
    joinDate: string // raw "2014-11-12"; the UI formats it
    posts: number
    favorites: number
    recentFavorites: Post[] // however many the page exposes (currently ≤5, possibly 0)
    recentUploads: Post[]
}

// --- Auth detection -------------------------------------------------------

// The site sets a JavaScript-readable `user_id` cookie on login; it lives and
// dies with the session (removed on logout). Returns the logged-in user id
// from a raw cookie string, or null when the cookie is absent or malformed.
export function parseUserIdFromCookie(cookie: string): number | null {
    for (const part of cookie.split(";")) {
        const eq = part.indexOf("=")
        if (eq === -1) continue
        if (part.slice(0, eq).trim() !== "user_id") continue
        return positiveInt(part.slice(eq + 1).trim())
    }
    return null
}

// --- Login ----------------------------------------------------------------

export type LoginResponse = { ok: true; userId: number } | { ok: false; error: string }

// POST the credentials to the site's login endpoint, going through the
// network layer like every other request (retry + transparent challenge
// solving). Success is detected via the `user_id` cookie: the browser applies
// the response's Set-Cookie before this request resolves, so a cookie read
// afterwards reflects the attempt and doubles as the user id. A stale cookie
// can't masquerade as a fresh login — the login route is unreachable while
// authenticated (see the guard in state/auth.ts), so a logged-in user never
// submits this form. On failure the cookie is absent and the response (the
// login form again, still at the login URL) carries the error message.
export async function login(username: string, password: string): Promise<LoginResponse> {
    const doc = await fetchDocument("/index.php?page=account&s=login&code=00", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ user: username, pass: password, submit: "Log in" }).toString(),
    })
    const userId = parseUserIdFromCookie(document.cookie)
    if (userId !== null) return { ok: true, userId }
    return { ok: false, error: parseLoginError(doc) }
}

// The failure message sits in a red-bordered div inside the login container.
// We key off the inline `border-color: red` style, which is a bit fragile; the
// fallback keeps us safe if the site changes its markup.
export function parseLoginError(doc: Document): string {
    const container = doc.querySelector("#user-login") ?? doc
    for (const el of container.querySelectorAll("div")) {
        if ((el.getAttribute("style") ?? "").includes("border-color: red")) {
            const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
            if (text !== "") return text
        }
    }
    return "Login failed. Check your username and password."
}

// --- Profile --------------------------------------------------------------

// A profile can be addressed by numeric id or by username; the site resolves
// both, so we keep whichever the URL carried (the account route serializes to
// exactly the profile page).
export type ProfileRef = { id: number } | { uname: string }

// Fetch and parse the profile view for a user, addressed by id or username.
export async function fetchProfile(ref: ProfileRef): Promise<UserProfile> {
    const url =
        "id" in ref
            ? `/index.php?page=account&s=profile&id=${ref.id}`
            : `/index.php?page=account&s=profile&uname=${encodeURIComponent(ref.uname)}`
    const doc = await fetchDocument(url)
    return extractUserProfile(doc)
}

export async function fetchUserProfile(userId: number): Promise<UserProfile> {
    return fetchProfile({ id: userId })
}

export function extractUserProfile(doc: Document): UserProfile {
    const username = (doc.querySelector("#content h2")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
    return {
        id: profileId(doc) ?? 0,
        username,
        joinDate: (statCell(doc, "Join Date")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        posts: parseCount(statCell(doc, "Posts")?.textContent ?? ""),
        favorites: parseCount(statCell(doc, "Favorites")?.textContent ?? ""),
        recentFavorites: recentPosts(doc, "Recent Favorites"),
        recentUploads: recentPosts(doc, "Recent Uploads"),
    }
}

// The <td> that follows the row whose label cell reads `label` (e.g. "Posts").
function statCell(doc: Document, label: string): Element | null {
    const table = doc.querySelector("#content table")
    if (!table) return null
    for (const tr of table.querySelectorAll("tr")) {
        const tds = tr.querySelectorAll("td")
        if (tds.length < 2) continue
        if ((tds[0].textContent ?? "").replace(/\s+/g, " ").trim() === label) return tds[1]
    }
    return null
}

// The `.image-list` that follows the given `<h4>` heading (e.g. "Recent
// Favorites"). The heading may carry a trailing "»" link, hence startsWith.
function recentPosts(doc: Document, heading: string): Post[] {
    for (const h4 of doc.querySelectorAll("h4")) {
        if (!(h4.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(heading)) continue
        const list = h4.parentElement?.querySelector(".image-list")
        return list ? extractPosts(list) : []
    }
    return []
}

// The profile table carries the numeric user id in several link hrefs (e.g. the
// "Favorites" row: `…?page=favorites&s=view&id=N`); the favorites page needs
// exactly that id, so we pull it from there.
function profileId(doc: Document): number | null {
    const a = doc.querySelector<HTMLAnchorElement>('a[href*="page=favorites"][href*="s=view"]')
    return a === null ? null : positiveInt(queryParam(a.getAttribute("href") ?? "", "id"))
}

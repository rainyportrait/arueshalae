import { fetchDocument } from "./network"
import { type Post, extractPosts } from "./post-list"

// A user's profile view: their stats and recent activity. The profile page
// (`page=favorites&s=view&id=N`) shows any user `N`, so the logged-in user's
// info and a future profile page share this one shape and parser.
export type UserProfile = {
    username: string // the first <h2> inside #content
    joinDate: string // raw "2014-11-12"; the UI formats it
    posts: number
    favorites: number
    recentFavorites: Post[] // however many the page exposes (currently ≤5, possibly 0)
    recentUploads: Post[]
}

// --- Auth detection -------------------------------------------------------

// Detect the logged-in user id from the account home page by positive match:
// the page carries a "» My Profile" link whose href is
// `…?page=favorites&s=view&id=N`. The logged-out page simply lacks that link,
// so "no link ⇒ guest" falls out for free — we never key off the "You are not
// logged in." wording.
export function parseUserIdFromAccountHome(doc: Document): number | null {
    for (const a of doc.querySelectorAll("a")) {
        const text = (a.textContent ?? "").replace(/\s+/g, " ").trim()
        if (!text.includes("My Profile")) continue
        const id = parseIdFromHref(a.getAttribute("href") ?? "")
        if (id !== null) return id
    }
    return null
}

// --- Login ----------------------------------------------------------------

export type LoginResponse = { ok: true; userId: number } | { ok: false; error: string }

// POST the credentials to the site's login endpoint. On success the site
// responds with the account home document (which carries the user id); on
// failure it returns the login form again, still at the login URL, with an
// error message. Because the form and the failure page share a URL, only the
// body can distinguish them — we reuse the same "is this the logged-in home
// page?" check from init via `parseUserIdFromAccountHome`.
export async function login(username: string, password: string): Promise<LoginResponse> {
    const body = new URLSearchParams({ user: username, pass: password, submit: "Log in" })
    const response = await fetch("/index.php?page=account&s=login&code=00", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    })
    const doc = new DOMParser().parseFromString(await response.text(), "text/html")
    const userId = parseUserIdFromAccountHome(doc)
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

// Fetch and parse the profile view for a user id.
export async function fetchUserProfile(userId: number): Promise<UserProfile> {
    const doc = await fetchDocument(`/index.php?page=account&s=profile&id=${userId}`)
    return extractUserProfile(doc)
}

export function extractUserProfile(doc: Document): UserProfile {
    const username = (doc.querySelector("#content h2")?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
    return {
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

function parseCount(raw: string): number {
    const digits = raw.replace(/[^\d]/g, "")
    return digits === "" ? 0 : Number(digits)
}

function parseIdFromHref(href: string): number | null {
    const queryIndex = href.indexOf("?")
    if (queryIndex === -1) return null
    const id = new URLSearchParams(href.slice(queryIndex + 1)).get("id")
    if (id === null) return null
    const n = Number(id)
    return Number.isInteger(n) && n > 0 ? n : null
}

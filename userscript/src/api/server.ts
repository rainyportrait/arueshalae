import { serverSettings } from "../state/settings.ts"
import type { PostDetails, PostMedia } from "./post-details.ts"
import type { Tag } from "./tags.ts"

// Client for the arueshalae server. All requests go through the base URL
// configured in Settings and are bounded by a hard timeout so a stopped
// server can't hang the UI.

export class ServerError extends Error {}

const TIMEOUT_MS = 5000

// The configured base URL without trailing slashes. May be empty if the
// setting was cleared; fetchServer validates it before use.
export function serverBaseUrl(): string {
    return serverSettings.val.url.trim().replace(/\/+$/, "")
}

// The core of fetchServer: resolves the URL and fetches with a bounded
// timeout, returning the raw response. Throws ServerError for bad URLs,
// network failures, and timeouts — never for the status code, so a caller
// that needs to read a non-2xx (e.g. a 404 as a no-op) can inspect it.
export async function fetchServerResponse(
    path: string,
    init?: RequestInit,
    timeoutMs = TIMEOUT_MS,
): Promise<Response> {
    const base = serverBaseUrl()
    if (base === "") throw new ServerError("No server URL is configured")

    let url: URL
    try {
        url = new URL(`${base}/${path}`)
    } catch {
        throw new ServerError("The server URL is not a valid URL")
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } catch (err) {
        if (controller.signal.aborted) throw new ServerError(`Timed out after ${timeoutMs / 1000}s`)
        throw new ServerError("Could not reach the server")
    } finally {
        clearTimeout(timeout)
    }
}

// Fetch a server endpoint (relative path, no leading slash) with a bounded
// timeout. Throws ServerError for bad URLs, network failures, timeouts, and
// non-2xx responses. The timeout defaults to the short control-plane budget;
// the media upload passes a much longer one (see savePostToServer).
export async function fetchServer(
    path: string,
    init?: RequestInit,
    timeoutMs = TIMEOUT_MS,
): Promise<Response> {
    const response = await fetchServerResponse(path, init, timeoutMs)
    if (!response.ok) {
        throw new ServerError(`The server responded with ${response.status} ${response.statusText}`)
    }
    return response
}

export async function fetchServerJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetchServerResponse(path, init)
    if (!response.ok) {
        let message = ""
        try {
            message = await response.text()
        } catch {
            // Fall back to the status when the response body is unreadable.
        }
        throw new ServerError(message || `The server responded with ${response.status}`)
    }
    return response.json() as Promise<T>
}

export function jsonRequest(data: unknown): RequestInit {
    return {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
    }
}

// The number of posts the server has downloaded. Used as the connection test:
// reaching this endpoint also proves we're talking to an arueshalae server.
export async function getDownloadCount(): Promise<number> {
    const response = await fetchServer("api/posts/count")
    return ((await response.json()) as { count: number }).count
}

// Downloaded media is independent of current membership. This includes retained
// unfavorited and upstream-deleted copies.
export async function checkDownloads(postIds: number[]): Promise<Set<number>> {
    if (postIds.length === 0) return new Set()

    const response = await fetchServer(`api/posts/downloaded?ids=${postIds.join(",")}`)
    const { postIds: downloaded } = (await response.json()) as { postIds: number[] }
    return new Set(downloaded)
}

// --- Saving posts -----------------------------------------------------------

// The tag shape the server's /api/posts endpoint expects. `name` is the tag's
// slug — rule34's canonical identifier, which the server matches searches
// exactly against — and `kind` reuses the userscript tag type (same values).
export type ServerTag = { name: string; kind: string }

export function serverTags(tags: Tag[]): ServerTag[] {
    return tags.map((tag) => ({ name: tag.slug, kind: tag.type }))
}

// The URL whose bytes belong in the library record: image posts carry the
// full-resolution "Original image" (the displayed src can be a sample),
// falling back to the displayed URL when the original link is missing; video
// posts carry the actual file.
export function mediaUrlFor(media: PostMedia): string {
    if (media.kind === "video") return media.src
    return media.originalImage !== "" ? media.originalImage : media.src
}

// Download the post's media (cross-origin, so through the injected GM fetcher
// — see gm-fetch.ts) and upload it to the /api/posts/{post_id} endpoint as
// multipart form data. The server infers the media type and extension from
// the bytes; the Blob's mime and file name are best-effort from the URL,
// useful in logs.
export type MediaFetcher = (url: string, timeoutMs: number) => Promise<ArrayBuffer>

export async function savePostToServer(
    post: PostDetails,
    fetchMedia: MediaFetcher,
    timeoutMs: number,
): Promise<void> {
    const url = mediaUrlFor(post.media)
    if (url === "") throw new Error("the post has no media URL")

    const bytes = await fetchMedia(url, timeoutMs)
    const form = new FormData()
    form.append("image", new Blob([bytes], { type: mimeFromUrl(url) }), fileNameFromUrl(url))
    form.append("tags", JSON.stringify(serverTags(post.tags)))

    // The upload leg streams the media to a localhost server: the default 5s
    // control-plane budget is far too short for a large file.
    const response = await fetchServer(
        `api/posts/${post.id}`,
        { method: "POST", body: form },
        timeoutMs,
    )
    const result = (await response.json()) as { cancelled?: boolean }

    if (result.cancelled) throw new Error("Download cancelled: post was unfavorited")
}

function mimeFromUrl(url: string): string {
    const path = url.split(/[?#]/)[0] ?? ""
    const dot = path.lastIndexOf(".")
    if (dot === -1) return "application/octet-stream"
    switch (path.slice(dot + 1).toLowerCase()) {
        case "jpg":
        case "jpeg":
            return "image/jpeg"
        case "png":
            return "image/png"
        case "gif":
            return "image/gif"
        case "webp":
            return "image/webp"
        case "mp4":
            return "video/mp4"
        case "webm":
            return "video/webm"
        default:
            return "application/octet-stream"
    }
}

function fileNameFromUrl(url: string): string {
    const path = url.split(/[?#]/)[0] ?? ""
    const name = path.slice(path.lastIndexOf("/") + 1)
    return name === "" ? "media" : name
}

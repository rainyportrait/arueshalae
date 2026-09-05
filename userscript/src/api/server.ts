import { serverSettings } from "../state/settings.ts"

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

// Fetch a server endpoint (relative path, no leading slash) with a bounded
// timeout. Throws ServerError for bad URLs, network failures, timeouts, and
// non-2xx responses.
export async function fetchServer(path: string, init?: RequestInit): Promise<Response> {
    const base = serverBaseUrl()
    if (base === "") throw new ServerError("No server URL is configured")

    let url: URL
    try {
        url = new URL(`${base}/${path}`)
    } catch {
        throw new ServerError("The server URL is not a valid URL")
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
        const res = await fetch(url, { ...init, signal: controller.signal })
        if (!res.ok)
            throw new ServerError(`The server responded with ${res.status} ${res.statusText}`)
        return res
    } catch (err) {
        if (err instanceof ServerError) throw err
        if (controller.signal.aborted)
            throw new ServerError(`Timed out after ${TIMEOUT_MS / 1000}s`)
        throw new ServerError("Could not reach the server")
    } finally {
        clearTimeout(timeout)
    }
}

// The number of posts the server has downloaded. Used as the connection test:
// reaching this endpoint also proves we're talking to an arueshalae server.
export async function getDownloadCount(): Promise<number> {
    const res = await fetchServer("count")
    return ((await res.json()) as { count: number }).count
}

import { isChallengeBody, solveCaptcha } from "../captcha.ts"

// Options for non-default requests (currently only the login form POST).
export type FetchOptions = {
    method?: "GET" | "POST"
    headers?: Record<string, string>
    body?: string
}

// rule34 rate-limits per IP: a tight burst (e.g. the init-time account + list
// + post details + neighbor prefetches) trips the limiter and the resulting
// 429s cascade, because the retry backoff is shorter than the limiter's
// window. Every request therefore goes through a single queue that spaces
// request starts by at least MIN_REQUEST_GAP_MS, turning bursts into a
// steady drip and spacing out retries for free.
const MIN_REQUEST_GAP_MS = 350
const BACKGROUND_TIMEOUT_MS = 30_000
let lastRequestStart = 0
const interactiveRequests: Array<() => Promise<void>> = []
const backgroundRequests: Array<() => Promise<void>> = []
let draining = false

// Interactive work takes the next slot ahead of queued background work. An
// already-running request is allowed to finish; every start still shares pacing.
function enqueueRequest<T>(request: () => Promise<T>, background = false): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const queue = background ? backgroundRequests : interactiveRequests
        queue.push(async () => {
            try {
                resolve(await request())
            } catch (error) {
                reject(error)
            }
        })
        void drainRequests()
    })
}

async function drainRequests(): Promise<void> {
    if (draining) return
    draining = true

    try {
        while (interactiveRequests.length > 0 || backgroundRequests.length > 0) {
            const wait = lastRequestStart + MIN_REQUEST_GAP_MS - Date.now()
            if (wait > 0) await sleep(wait)

            const request = interactiveRequests.shift() ?? backgroundRequests.shift()
            if (request === undefined) break

            lastRequestStart = Date.now()
            await request()
        }
    } finally {
        draining = false
    }
}

// Fetch a URL, transparently solving a bot challenge (a 4xx challenge page) if
// the first response is one, and return a successful (200) Response. The 200
// body is left unread so the caller can parse it as text/JSON.
export async function fetchCleared(url: string, options: FetchOptions = {}): Promise<Response> {
    for (;;) {
        const response = await enqueueRequest(() => fetch(url, options))
        if (response.status === 200) return response
        if (
            response.status >= 400 &&
            response.status < 500 &&
            isChallengeBody(await response.text())
        ) {
            await solveCaptcha(url)
            continue // the challenge cookie is set; retry now succeeds
        }
        throw new Error(`${url} returned status ${response.status}`)
    }
}

// Like fetchCleared, but returns the non-200 response (after any challenge
// solving) instead of throwing, so the caller can inspect the status. For
// mutations that report their outcome in the status code rather than the
// body.
export async function fetchClearedAny(url: string, options: FetchOptions = {}): Promise<Response> {
    for (;;) {
        const response = await enqueueRequest(() => fetch(url, options))
        if (response.status === 200) return response
        if (
            response.status >= 400 &&
            response.status < 500 &&
            isChallengeBody(await response.text())
        ) {
            await solveCaptcha(url)
            continue // the challenge cookie is set; retry now succeeds
        }
        return response
    }
}

async function baseFetchDocument(url: string, options: FetchOptions): Promise<Document> {
    const response = await fetchCleared(url, options)
    const body = await response.text()
    return new DOMParser().parseFromString(body, "text/html")
}

export async function fetchDocument(url: string, options: FetchOptions = {}): Promise<Document> {
    return retry<Document>(() => baseFetchDocument(url, options))
}

export async function retry<T>(
    request: () => Promise<T>,
    maxRetries: number = 5,
    baseDelay: number = 350,
): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await request()
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error))
            const jitter = Math.random() * 30
            const delay = baseDelay * Math.pow(2, attempt) + jitter
            await sleep(delay)
        }
    }

    throw lastError ?? new Error("Exceeded max retries")
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// Background jobs make one bounded attempt. Their persistent queue owns retries;
// a challenge or timeout yields work rather than monopolizing a worker lease.
export function fetchBackground(
    url: string,
    isCurrent: () => boolean = () => true,
): Promise<Response> {
    return enqueueRequest(() => {
        if (!isCurrent()) throw new Error("Background worker stopped")
        return fetch(url, { signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS) })
    }, true)
}

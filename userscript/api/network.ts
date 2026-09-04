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
let requestQueue: Promise<void> = Promise.resolve()
let lastRequestStart = 0

// Serialize run behind every queued request and start it no sooner than
// MIN_REQUEST_GAP_MS after the previous request started. A rejection does not
// break the chain; the caller still receives the error.
function enqueueRequest<T>(run: () => Promise<T>): Promise<T> {
    const result = requestQueue.then(async () => {
        const wait = lastRequestStart + MIN_REQUEST_GAP_MS - Date.now()
        if (wait > 0) await sleep(wait)
        lastRequestStart = Date.now()
        return run()
    })
    requestQueue = result.then(
        () => undefined,
        () => undefined,
    )
    return result
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

async function baseFetchDocument(url: string, options: FetchOptions): Promise<Document> {
    const response = await fetchCleared(url, options)
    const body = await response.text()
    return new DOMParser().parseFromString(body, "text/html")
}

export async function fetchDocument(url: string, options: FetchOptions = {}): Promise<Document> {
    return retry<Document>(() => baseFetchDocument(url, options))
}

export async function retry<T>(
    fetchFn: () => Promise<T>,
    maxRetries: number = 5,
    baseDelay: number = 350,
): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fetchFn()
        } catch (e) {
            lastError = e instanceof Error ? e : new Error(String(e))
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

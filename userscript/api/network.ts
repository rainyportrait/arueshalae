import { isChallengeBody, solveCaptcha } from "../captcha.ts"

// Options for non-default requests (currently only the login form POST).
export type FetchOptions = {
    method?: "GET" | "POST"
    headers?: Record<string, string>
    body?: string
}

// Fetch a URL, transparently solving a bot challenge (a 4xx challenge page) if
// the first response is one, and return a successful (200) Response. The 200
// body is left unread so the caller can parse it as text/JSON. Used for every
// `fetch`-based request path.
export async function fetchCleared(url: string, options: FetchOptions = {}): Promise<Response> {
    for (;;) {
        const response = await fetch(url, options)
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

// Retry helper with exponential backoff.
export async function retry<T>(
    fetchFn: () => Promise<T>,
    maxRetries: number = 5,
    baseDelay: number = 100,
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

import { solveCaptcha } from "../captcha"

// A bot challenge is returned as a 4xx whose body carries a marker word. We
// detect it on the response body so it works for any resource type.
function isChallengeBody(body: string): boolean {
    return body.toLowerCase().includes("captcha")
}

// Fetch a URL, transparently solving a bot challenge (a 4xx challenge page) if
// the first response is one, and return a successful (200) Response. The 200
// body is left unread so the caller can parse it as text/JSON. Used for every
// `fetch`-based request path.
export async function fetchCleared(url: string): Promise<Response> {
    for (;;) {
        const response = await fetch(url)
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

async function baseFetchDocument(url: string): Promise<Document> {
    const response = await fetchCleared(url)
    const body = await response.text()
    return new DOMParser().parseFromString(body, "text/html")
}

export async function fetchDocument(url: string): Promise<Document> {
    return retry<Document>(url, async () => baseFetchDocument(url))
}

export async function fetchImage(url: string): Promise<Blob> {
    return retry<Blob>(url, async () => baseFetchImage(url))
}

async function baseFetchImage(url: string): Promise<Blob> {
    const result: any = await new Promise((resolve, reject) => {
        const gmOptions: any = {
            url,
            method: "GET",
            responseType: "blob",
            onload: resolve,
            onerror: (r: any) => {
                reject(r.error || new Error("Network error"))
            },
        }
        GM.xmlHttpRequest(gmOptions)
    })

    if (result.status === 200) return result.response

    if (
        result.status >= 400 &&
        result.status < 500 &&
        isChallengeBody(await blobText(result.response))
    ) {
        await solveCaptcha(url)
        return baseFetchImage(url) // retry once the challenge is cleared
    }
    throw new Error(`Image fetch failed: ${result.status}`)
}

// Read a GM blob response as text (empty string when it isn't a readable Blob).
async function blobText(blob: unknown): Promise<string> {
    if (blob instanceof Blob) {
        try {
            return await blob.text()
        } catch {
            return ""
        }
    }
    return ""
}

// Retry helper with exponential backoff
export async function retry<T>(
    url: string,
    fetchFn: (url: string) => Promise<T>,
    maxRetries: number = 15,
    baseDelay: number = 100,
): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fetchFn(url)
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

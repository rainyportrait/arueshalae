import { extractUserProfile } from "../api/auth.ts"
import { extractFavorites } from "../api/favorites.ts"
import { fetchBackground } from "../api/network.ts"
import { type PostDetails, extractPostDetails } from "../api/post-details.ts"
import { isChallengeBody, solveCaptcha } from "../captcha.ts"

export const FAVORITES_PAGE_SIZE = 50
const MAX_ATTEMPTS = 5
const INITIAL_BACKOFF_MS = 2_000
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

// Read-only rule34 access used by synchronization. Keeping it here makes the
// server boundary explicit: none of these requests can originate in Rust.
export class Rule34Reader {
    constructor(private readonly userId: number) {}

    async reportedCount(): Promise<number> {
        const profile = extractUserProfile(
            await this.document(`/index.php?page=account&s=profile&id=${this.userId}`),
        )
        if (profile.id !== this.userId || profile.username === "") {
            throw new Error("Rule34 returned an unexpected account page")
        }
        return profile.favorites
    }

    async favoritesPage(position: number): Promise<{ ids: number[]; lastPosition: number }> {
        const document = await this.document(
            `/index.php?page=favorites&s=view&id=${this.userId}&pid=${position}`,
        )
        const page = extractFavorites(document, position)
        const ids = page.posts.map((post) => post.id)
        if (new Set(ids).size !== ids.length) throw new Error("Favorites page contains duplicates")
        return { ids, lastPosition: page.lastPagePID }
    }

    async postDetails(postId: number): Promise<PostDetails | null> {
        const response = await this.request(`/index.php?page=post&s=view&id=${postId}`)
        const body = await response.text()
        if (response.status === 404 || response.status === 410) return null
        if (!response.ok) throw new Error(`Post check returned ${response.status}`)

        const document = new DOMParser().parseFromString(body, "text/html")
        const post = extractPostDetails(document, postId)
        if (post.media.src === "") throw new Error(`Could not verify post ${postId}`)
        return post
    }

    private async document(url: string): Promise<Document> {
        const response = await this.request(url)
        if (!response.ok) throw new Error(`Rule34 returned ${response.status}`)
        return new DOMParser().parseFromString(await response.text(), "text/html")
    }

    private async request(url: string): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            const response = await fetchBackground(url)
            if (isChallengeBody(await response.clone().text())) {
                if (attempt + 1 >= MAX_ATTEMPTS) {
                    throw new Error("Rule34 challenge could not be cleared")
                }
                await solveCaptcha(url)
                continue
            }
            if (!RETRYABLE_STATUSES.has(response.status) || attempt + 1 >= MAX_ATTEMPTS) {
                return response
            }

            await sleep(retryDelay(response, attempt))
        }
    }
}

function retryDelay(response: Response, attempt: number): number {
    const retryAfter = response.headers.get("Retry-After")
    if (retryAfter !== null) {
        const seconds = Number(retryAfter)
        if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

        const date = Date.parse(retryAfter)
        if (Number.isFinite(date)) return Math.max(0, date - Date.now())
    }

    const exponential = INITIAL_BACKOFF_MS * 2 ** attempt
    return exponential + Math.random() * Math.min(1_000, exponential / 4)
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

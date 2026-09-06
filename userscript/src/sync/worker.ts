import { extractUserProfile } from "../api/auth.ts"
import { extractFavorites } from "../api/favorites.ts"
import { fetchBackground } from "../api/network.ts"
import { type PostDetails, extractPostDetails } from "../api/post-details.ts"
import { syncCommand } from "../api/sync.ts"
import { isChallengeBody } from "../captcha.ts"
import { auth } from "../state/auth.ts"
import { serverSettings } from "../state/settings.ts"

export type SyncWorkerKind = "download" | "reconciliation"

const FAVORITES_PAGE_SIZE = 50
const WORKER_STALL_TIMEOUT_MS = 6 * 60 * 1000
const OWNER_TOKEN = crypto.randomUUID()

export class SyncWorker {
    private alive = true
    private madeProgress = false
    private lastProgressAt = Date.now()
    private readonly checkedResumeBoundaries = new Set<string>()
    private readonly account = auth.rawVal
    private readonly settings = serverSettings.rawVal

    private constructor(
        readonly kind: SyncWorkerKind,
        readonly generation: number,
    ) {}

    static async acquire(kind: SyncWorkerKind): Promise<SyncWorker | null> {
        const lease = await syncCommand<{ generation: number | null }>("lease", {
            owner: OWNER_TOKEN,
            worker: kind,
        })

        return lease.generation === null ? null : new SyncWorker(kind, lease.generation)
    }

    isCurrent(): boolean {
        const currentAccount = auth.rawVal

        return (
            this.alive &&
            serverSettings.rawVal.enabled &&
            serverSettings.rawVal.url === this.settings.url &&
            currentAccount.status === "authenticated" &&
            this.account.status === "authenticated" &&
            currentAccount.userId === this.account.userId
        )
    }

    hasStalled(): boolean {
        return Date.now() - this.lastProgressAt > WORKER_STALL_TIMEOUT_MS
    }

    stop(): void {
        this.alive = false
    }

    recordProgress(): void {
        this.madeProgress = true
        this.lastProgressAt = Date.now()
    }

    hasCheckedResumeBoundary(key: string): boolean {
        return this.checkedResumeBoundaries.has(key)
    }

    markResumeBoundaryChecked(key: string): void {
        this.checkedResumeBoundaries.add(key)
    }

    async command<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
        if (!this.isCurrent()) throw new Error("Worker context changed")

        return syncCommand<T>(action, {
            owner: OWNER_TOKEN,
            worker: this.kind,
            generation: this.generation,
            ...data,
        })
    }

    async renew(): Promise<void> {
        const result = await this.command<{ ok: boolean }>("renew", {
            progress: this.madeProgress,
        })
        this.madeProgress = false
        if (!result.ok) this.stop()
    }

    async release(): Promise<void> {
        await this.command("release")
    }

    async pace(): Promise<void> {
        const { wait } = await this.command<{ wait: number }>("pace")
        await sleep(wait)

        if (!this.isCurrent()) throw new Error("Worker stopped")
    }

    async request(url: string): Promise<Response> {
        await this.pace()

        const response = await fetchBackground(url, () => this.isCurrent())
        this.recordProgress()
        return response
    }

    async document(url: string): Promise<Document> {
        const response = await this.request(url)
        if (!response.ok) throw new Error(`Upstream returned ${response.status}`)

        return new DOMParser().parseFromString(await response.text(), "text/html")
    }

    async favoriteCount(): Promise<number> {
        if (this.account.status !== "authenticated") throw new Error("Not signed in")

        const profile = extractUserProfile(
            await this.document(`/index.php?page=account&s=profile&id=${this.account.userId}`),
        )
        if (profile.id !== this.account.userId || profile.username === "") {
            throw new Error("Unrecognized account page")
        }

        return profile.favorites
    }

    async favoritePage(position: number, count: number): Promise<number[]> {
        if (this.account.status !== "authenticated") throw new Error("Not signed in")

        const document = await this.document(
            `/index.php?page=favorites&s=view&id=${this.account.userId}&pid=${position}`,
        )
        const postIds = extractFavorites(document, position).posts.map((post) => post.id)
        const expected = Math.min(FAVORITES_PAGE_SIZE, Math.max(0, count - position))
        if (postIds.length !== expected || new Set(postIds).size !== postIds.length) {
            throw new Error("Favorites changed or page could not be parsed")
        }

        return postIds
    }

    async postDetails(postId: number): Promise<PostDetails | null> {
        const response = await this.request(`/index.php?page=post&s=view&id=${postId}`)
        const body = await response.text()

        if (isChallengeBody(body)) throw new Error("Upstream challenge requires attention")
        if (response.status === 404 || response.status === 410) return null
        if (!response.ok) throw new Error(`Post check returned ${response.status}`)

        const document = new DOMParser().parseFromString(body, "text/html")
        const post = extractPostDetails(document, postId)
        if (post.media.src === "") throw new Error("Post availability is unresolved")

        return post
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

import van from "vanjs-core"

import { extractUserProfile } from "../api/auth.ts"
import { extractFavorites } from "../api/favorites.ts"
import { gmFetchArrayBuffer } from "../api/gm-fetch.ts"
import { fetchBackground } from "../api/network.ts"
import { type PostDetails, extractPostDetails } from "../api/post-details.ts"
import { savePostToServer } from "../api/server.ts"
import { syncCommand } from "../api/sync.ts"
import { isChallengeBody } from "../captcha.ts"
import { reconcilePrefix, reconcileRemovals } from "../sync/reconcile.ts"
import { auth } from "./auth.ts"
import { refreshLibrary } from "./library.ts"
import { serverSettings } from "./settings.ts"

export type SyncStatus = {
    reconciliationPaused: boolean
    downloadsPaused: boolean
    budget: number
    baseline: number | null
    active: number
    downloaded: number
    archived: number
    deleted: number
    pending: number
    run: { id: number; status: string; checkpoint: number; message: string | null } | null
}

export const syncStatus = van.state<SyncStatus | null>(null)
export const syncError = van.state("")

export async function syncControl(
    action: string,
    data: Record<string, unknown> = {},
): Promise<void> {
    await syncCommand(action, data)
    await refreshStatus()
}
async function refreshStatus() {
    syncStatus.val = await syncCommand<SyncStatus>("status")
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const owner = crypto.randomUUID()
const running = new Set<string>()

class Worker {
    readonly resumeChecked = new Set<string>()
    alive = true
    progress = false
    lastProgress = Date.now()
    readonly account = auth.rawVal
    readonly settings = serverSettings.rawVal
    constructor(
        readonly worker: string,
        readonly generation: number,
    ) {}

    valid() {
        const a = auth.rawVal
        return (
            this.alive &&
            serverSettings.rawVal.enabled &&
            serverSettings.rawVal.url === this.settings.url &&
            a.status === "authenticated" &&
            this.account.status === "authenticated" &&
            a.userId === this.account.userId
        )
    }

    async command<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
        if (!this.valid()) throw new Error("Worker context changed")
        return syncCommand<T>(action, {
            owner,
            worker: this.worker,
            generation: this.generation,
            ...data,
        })
    }

    async pace() {
        const { wait } = await this.command<{ wait: number }>("pace")
        await sleep(wait)
        if (!this.valid()) throw new Error("Worker stopped")
    }

    async request(url: string): Promise<Response> {
        await this.pace()
        const response = await fetchBackground(url, () => this.valid())
        this.progress = true
        this.lastProgress = Date.now()
        return response
    }

    async document(url: string): Promise<Document> {
        const r = await this.request(url)
        if (!r.ok) throw new Error(`Upstream returned ${r.status}`)
        return new DOMParser().parseFromString(await r.text(), "text/html")
    }

    async profile(): Promise<number> {
        const a = this.account
        if (a.status !== "authenticated") throw new Error("Not signed in")
        const p = extractUserProfile(
            await this.document(`/index.php?page=account&s=profile&id=${a.userId}`),
        )
        if (p.id !== a.userId || p.username === "") throw new Error("Unrecognized account page")
        return p.favorites
    }

    async page(position: number, count: number): Promise<number[]> {
        const a = this.account
        if (a.status !== "authenticated") throw new Error("Not signed in")
        const doc = await this.document(
            `/index.php?page=favorites&s=view&id=${a.userId}&pid=${position}`,
        )
        // Favorites listing uses s=view? Router supplies the canonical list route below.
        const posts = extractFavorites(doc, position).posts.map((p) => p.id)
        const expected = Math.min(50, Math.max(0, count - position))
        if (posts.length !== expected || new Set(posts).size !== posts.length)
            throw new Error("Favorites changed or page could not be parsed")
        return posts
    }

    async details(postId: number): Promise<PostDetails | null> {
        const r = await this.request(`/index.php?page=post&s=view&id=${postId}`)
        const body = await r.text()
        if (isChallengeBody(body)) throw new Error("Upstream challenge requires attention")
        if (r.status === 404 || r.status === 410) return null
        if (!r.ok) throw new Error(`Post check returned ${r.status}`)
        const doc = new DOMParser().parseFromString(body, "text/html")
        const post = extractPostDetails(doc, postId)
        if (!post.media.src) throw new Error("Post availability is unresolved")
        return post
    }
}

async function download(w: Worker) {
    for (;;) {
        const { postId } = await w.command<{ postId: number | null }>("next")
        if (postId === null) return
        try {
            const post = await w.details(postId)
            if (post === null) {
                await w.command("availability", { postId, value: "deleted" })
                continue
            }
            await w.command("availability", { postId, value: "available" })
            await w.pace()
            await savePostToServer(
                post,
                async (url, timeout) => {
                    const bytes = await gmFetchArrayBuffer(url, timeout)
                    w.progress = true
                    w.lastProgress = Date.now()
                    if (!w.valid()) throw new Error("Worker stopped")
                    return bytes
                },
                5 * 60 * 1000,
            )
            w.progress = true
            w.lastProgress = Date.now()
            await refreshLibrary([postId])
        } catch (error) {
            await w.command("failed", { postId, value: String(error) })
        }
    }
}

type FullRun = { runId: number | null; position: number; phase: string; count: number | null }

async function full(w: Worker, run: FullRun) {
    if (run.runId === null) return
    const count = run.count ?? (await w.profile())
    const resumeKey = `${run.runId}:${run.phase}`
    if (!w.resumeChecked.has(resumeKey)) {
        if (run.count !== null && (await w.profile()) !== count)
            throw new Error("Favorites changed since checkpoint")
        if (run.position > 0) {
            const position = Math.max(0, run.position - 50)
            const ids = await w.page(position, count)
            await w.command("boundary", { runId: run.runId, position, ids })
        }
        w.resumeChecked.add(resumeKey)
    }
    if (run.phase === "scan" || run.phase === "verify") {
        if (run.phase === "verify" && count !== run.count)
            throw new Error("Favorites changed between scan passes; cancel and restart")
        const ids = await w.page(run.position, count)
        await w.command("page", {
            runId: run.runId,
            position: run.position,
            count,
            ids,
            value: run.position + ids.length >= count ? "end" : "",
        })
    } else {
        const { ids, front } = await w.command<{ ids: number[]; front: number[] }>("finish", {
            runId: run.runId,
        })
        const postId = ids[0]
        if (postId !== undefined) {
            const post = await w.details(postId)
            await w.command("classified", {
                runId: run.runId,
                postId,
                value: post === null ? "deleted" : "available",
            })
        } else {
            if (count !== run.count || (await w.profile()) !== count)
                throw new Error("Favorites changed during classification")
            const currentFront = await w.page(0, count)
            if (
                currentFront.length !== front.length ||
                !currentFront.every((id, i) => id === front[i])
            )
                throw new Error("Favorites changed during classification")
            await w.command("finish", { runId: run.runId, value: "commit" })
        }
    }
}

async function incremental(w: Worker) {
    const base = await w.command<{
        ids: number[]
        baseline: number | null
        due: boolean
        budget: number
        revision: number
    }>("baseline")
    if (!base.due) return
    let remaining = base.budget
    const spend = () => {
        if (remaining-- <= 0) throw new Error("Request budget exhausted; reconciliation unresolved")
    }
    const profile = async () => {
        spend()
        return w.profile()
    }
    const observed = new Set<number>()
    const page = async (p: number, c: number) => {
        spend()
        const ids = await w.page(p, c)
        for (const id of ids) observed.add(id)
        return ids
    }
    let front: number[] = []
    try {
        let count = await profile()
        front = await page(0, count)
        if (base.baseline === null) throw new Error("Initial full scan required to establish order")
        // Read through the new/re-added prefix until an old entry anchors it.
        while (front.length < count && !front.some((id) => base.ids.includes(id))) {
            front.push(...(await page(front.length, count)))
        }
        const removed: number[] = []
        const local = await reconcileRemovals(
            reconcilePrefix(base.ids, front),
            front.length,
            count,
            (p) => page(p, count),
            async (candidates) => {
                for (const postId of candidates) {
                    spend()
                    const post = await w.details(postId)
                    await w.command("availability", {
                        postId,
                        value: post === null ? "deleted" : "available",
                    })
                    if (post !== null) removed.push(postId)
                }
                if ((await profile()) !== count) throw new Error("Favorites changed during search")
            },
        )
        // Recheck the head after deeper requests before publishing any removals.
        if (removed.length > 0) {
            const head = await page(0, count)
            if (!head.every((id, i) => id === front[i]))
                throw new Error("Favorites changed during search")
        }
        await w.command("incremental", {
            ids: local,
            observed: [...observed],
            removed,
            count,
            revision: base.revision,
            value: "reconciled",
        })
    } catch (error) {
        await w.command("incremental", {
            ids: front,
            observed: [...observed],
            revision: base.revision,
            value: String(error),
        })
    }
}

async function work(kind: string) {
    if (running.has(kind)) return
    running.add(kind)
    let w: Worker | undefined
    let timer: ReturnType<typeof setInterval> | undefined
    try {
        const lease = await syncCommand<{ generation: number | null }>("lease", {
            owner,
            worker: kind,
        })
        if (lease.generation === null) return
        w = new Worker(kind, lease.generation)
        const worker = w
        timer = setInterval(() => {
            if (!worker.valid() || Date.now() - worker.lastProgress > 6 * 60 * 1000) {
                worker.alive = false
                return
            }
            void worker.command<{ ok: boolean }>("renew", { progress: worker.progress }).then(
                (r) => {
                    worker.progress = false
                    if (!r.ok) worker.alive = false
                },
                () => {
                    worker.alive = false
                },
            )
        }, 20000)
        if (kind === "download") await download(w)
        else {
            for (;;) {
                const run = await w.command<FullRun>("start")
                if (run.runId === null) break
                try {
                    await full(w, run)
                } catch (error) {
                    await w.command("run-error", { runId: run.runId, value: String(error) })
                    throw error
                }
            }
            await incremental(w)
        }
    } catch (error) {
        syncError.val = String(error)
    } finally {
        if (timer !== undefined) clearInterval(timer)
        if (w?.valid()) await w.command("release").catch(() => {})
        running.delete(kind)
    }
}

async function tick() {
    if (!serverSettings.rawVal.enabled || auth.rawVal.status !== "authenticated") return
    try {
        await refreshStatus()
        syncError.val = ""
        if (!syncStatus.rawVal?.reconciliationPaused) void work("reconciliation")
        if (!syncStatus.rawVal?.downloadsPaused) void work("download")
    } catch (error) {
        syncError.val = String(error)
    }
}

setInterval(() => void tick(), 15000 + Math.random() * 3000)
van.derive(() => {
    serverSettings.val
    auth.val
    void tick()
})

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails as PostDetailsData } from "../../src/api/post-details.ts"
import type { Post, PostList } from "../../src/api/post-list.ts"
import { flushVan, resetDom } from "../dom.ts"

// The triggers ask the server via api/server.ts; keep them off the network.
const api = vi.hoisted(() => ({
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/server.ts", () => ({
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    ServerError: class ServerError extends Error {},
}))
// Authenticating a test fires the profile loader in state/auth.ts; answer it
// without a network.
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

function post(id: number): Post {
    return {
        id,
        link: `/index.php?page=post&s=view&id=${id}`,
        thumbnail: `//cdn.example/${id}.jpg`,
        tags: [],
    }
}

function listPage(ids: number[]): PostList & { pid: number; query: string | undefined } {
    return {
        posts: ids.map(post),
        lastPagePID: 0,
        tags: [],
        pid: 0,
        query: undefined,
    }
}

function details(id: number): PostDetailsData {
    return {
        id,
        title: "",
        media: {
            kind: "image",
            src: `//cdn.example/${id}.jpg`,
            originalImage: `//cdn.example/${id}.jpg`,
            width: 100,
            height: 100,
        },
        posted: "",
        poster: "",
        posterHref: "",
        source: "",
        sourceHref: "",
        rating: "",
        score: 0,
        tags: [],
    }
}

// A fresh module graph per test: the downloaded state and the answered set
// are module-scoped, and the tests sit on the settings route so no loader
// fires for real.
async function importAll() {
    const downloaded = await import("../../src/state/downloaded.ts")
    const { list } = await import("../../src/state/list.ts")
    const { favorites } = await import("../../src/state/favorites.ts")
    const { details: detailsState } = await import("../../src/state/details.ts")
    const { gallery } = await import("../../src/state/gallery.ts")
    const { auth } = await import("../../src/state/auth.ts")
    const { serverSettings } = await import("../../src/state/settings.ts")
    return { ...downloaded, list, favorites, detailsState, gallery, auth, serverSettings }
}

async function enableServer(m: Awaited<ReturnType<typeof importAll>>): Promise<void> {
    m.serverSettings.val = { ...m.serverSettings.val, enabled: true }
    await flushVan()
}

describe("state/downloaded", () => {
    beforeEach(() => {
        vi.resetModules()
        api.checkDownloads.mockReset()
        api.getDownloadCount.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("checks a settled list page and folds the answer into the set", async () => {
        const m = await importAll()
        await enableServer(m)
        api.checkDownloads.mockResolvedValue(new Set([2, 3]))

        m.list.val = { status: "ready", ...listPage([1, 2, 3]) }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenCalledTimes(1)
        expect(api.checkDownloads).toHaveBeenCalledWith([1, 2, 3])
        expect([...m.downloaded.val].sort((a, b) => a - b)).toEqual([2, 3])
    })

    it("does not re-query answered ids when the same page settles again", async () => {
        const m = await importAll()
        await enableServer(m)

        m.list.val = { status: "ready", ...listPage([1, 2]) }
        await flushVan()
        // A back/forward replay republishes the page: a new object, same ids.
        m.list.val = { status: "ready", ...listPage([1, 2]) }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenCalledTimes(1)
    })

    it("queries only the new ids of an overlapping page", async () => {
        const m = await importAll()
        await enableServer(m)

        m.list.val = { status: "ready", ...listPage([1, 2]) }
        await flushVan()
        m.list.val = { status: "ready", ...listPage([2, 3]) }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenNthCalledWith(2, [3])
    })

    it("drops failed checks silently and retries them on the next settle", async () => {
        const m = await importAll()
        await enableServer(m)
        api.checkDownloads.mockRejectedValue(new Error("server down"))

        m.list.val = { status: "ready", ...listPage([1]) }
        await flushVan()
        expect(m.downloaded.val).toEqual(new Set())

        api.checkDownloads.mockResolvedValue(new Set([1]))
        m.list.val = { status: "ready", ...listPage([1]) }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenCalledTimes(2)
        expect(m.downloaded.val.has(1)).toBe(true)
    })

    it("does not check while the server is disabled", async () => {
        const m = await importAll()

        m.list.val = { status: "ready", ...listPage([1]) }
        await flushVan()

        expect(api.checkDownloads).not.toHaveBeenCalled()
    })

    it("checks the current page when the server is enabled mid-session", async () => {
        const m = await importAll()
        m.list.val = { status: "ready", ...listPage([1]) }
        await flushVan()
        expect(api.checkDownloads).not.toHaveBeenCalled()

        api.checkDownloads.mockResolvedValue(new Set([1]))
        m.serverSettings.val = { ...m.serverSettings.val, enabled: true }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenCalledWith([1])
        expect(m.downloaded.val.has(1)).toBe(true)
    })

    it("checks the logged-in user's own favorites page for local media", async () => {
        const m = await importAll()
        await enableServer(m)
        m.auth.val = { status: "authenticated", userId: 7 }
        api.checkDownloads.mockResolvedValue(new Set([1]))

        m.favorites.val = {
            status: "ready",
            posts: [post(1)],
            lastPagePID: 0,
            id: 7,
            pid: 0,
        }
        await flushVan()
        expect(api.checkDownloads).toHaveBeenCalledWith([1])
        expect(m.downloaded.val.has(1)).toBe(true)

        m.favorites.val = {
            status: "ready",
            posts: [post(1), post(2)],
            lastPagePID: 0,
            id: 8,
            pid: 0,
        }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenLastCalledWith([2])
    })

    it("checks the details page's post as it settles", async () => {
        const m = await importAll()
        await enableServer(m)
        api.checkDownloads.mockResolvedValue(new Set([42]))

        m.detailsState.val = { status: "ready", post: details(42), origin: undefined }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenCalledWith([42])
        expect(m.downloaded.val.has(42)).toBe(true)
    })

    it("checks every post loaded into the gallery filmstrip", async () => {
        const m = await importAll()
        await enableServer(m)
        api.checkDownloads.mockResolvedValue(new Set([2]))
        const origin = { kind: "list" as const, tags: "test", pid: 0 }

        m.gallery.val = {
            status: "ready",
            origin,
            pages: [
                { pid: 0, posts: [post(1)] },
                { pid: 42, posts: [post(2)] },
            ],
            lastPagePID: 42,
        }
        await flushVan()

        expect(api.checkDownloads).toHaveBeenCalledWith([1, 2])
        expect(m.downloaded.val.has(2)).toBe(true)
    })

    it("keeps the set's identity stable when a check adds nothing", async () => {
        const m = await importAll()
        await enableServer(m)
        // An all-absent answer: no state write, so a grid never re-renders.
        const before = m.downloaded.val

        m.list.val = { status: "ready", ...listPage([1]) }
        await flushVan()
        expect(m.downloaded.val).toBe(before)

        m.markDownloaded([])
        expect(m.downloaded.val).toBe(before)

        m.markDownloaded([5])
        expect(m.downloaded.val).not.toBe(before)
        expect(m.downloaded.val.has(5)).toBe(true)
    })
})

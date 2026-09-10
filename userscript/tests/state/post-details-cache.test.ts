import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails } from "../../src/api/post-details.ts"
import { flushVan, resetDom } from "../dom.ts"

const api = vi.hoisted(() => ({
    fetchPostDetails: vi.fn(),
    observePost: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/post-details.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchPostDetails: api.fetchPostDetails,
}))
vi.mock("../../src/api/library.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    observePost: api.observePost,
}))
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

function details(id: number): PostDetails {
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

async function importAll() {
    const cache = await import("../../src/state/post-details-cache.ts")
    const { auth } = await import("../../src/state/auth.ts")
    const { serverSettings } = await import("../../src/state/settings.ts")
    return { ...cache, auth, serverSettings }
}

describe("state/post-details-cache", () => {
    beforeEach(() => {
        vi.resetModules()
        api.fetchPostDetails.mockReset()
        api.observePost.mockReset()
        api.observePost.mockResolvedValue(undefined)
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("observes fetched pages, including gallery-style prefetches", async () => {
        const m = await importAll()
        m.auth.val = { status: "authenticated", userId: 7 }
        m.serverSettings.val = { ...m.serverSettings.val, enabled: true }
        const post = details(42)
        api.fetchPostDetails.mockResolvedValue(post)

        await m.cachedPostDetails(42)

        expect(api.observePost).toHaveBeenCalledOnce()
        expect(api.observePost).toHaveBeenCalledWith(post)
    })

    it("observes a primed initial post page", async () => {
        const m = await importAll()
        m.auth.val = { status: "authenticated", userId: 7 }
        m.serverSettings.val = { ...m.serverSettings.val, enabled: true }
        const post = details(42)

        m.primePostDetails(42, post)

        expect(api.observePost).toHaveBeenCalledWith(post)
    })

    it("observes pages loaded before the server becomes eligible", async () => {
        const m = await importAll()
        const post = details(42)
        api.fetchPostDetails.mockResolvedValue(post)
        await m.cachedPostDetails(42)
        expect(api.observePost).not.toHaveBeenCalled()

        m.auth.val = { status: "authenticated", userId: 7 }
        m.serverSettings.val = { ...m.serverSettings.val, enabled: true }
        await flushVan()

        expect(api.observePost).toHaveBeenCalledWith(post)
    })
})

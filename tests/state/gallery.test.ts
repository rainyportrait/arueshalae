import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Post } from "../../userscript/api/post-list.ts"
import { resetDom } from "../dom.ts"

const api = vi.hoisted(() => ({
    fetchFavorites: vi.fn(),
    fetchPostList: vi.fn(),
}))

vi.mock("../../userscript/api/favorites.ts", () => ({ fetchFavorites: api.fetchFavorites }))
vi.mock("../../userscript/api/post-list.ts", () => ({ fetchPostList: api.fetchPostList }))

function post(id: number): Post {
    return {
        id,
        link: `/index.php?page=post&s=view&id=${id}`,
        thumbnail: `//cdn.example/${id}.jpg`,
        tags: [],
    }
}

describe("gallery pagination", () => {
    beforeEach(() => {
        vi.resetModules()
        api.fetchFavorites.mockReset()
        api.fetchPostList.mockReset()
        resetDom()
    })

    it("clamps a stale last-page value after fetching an empty page", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                posts: pid === 0 ? [post(1)] : pid === 42 ? [post(2)] : [],
                lastPagePID: 84,
                tags: [],
            }),
        )
        const { collectionFor, ensurePage } =
            await import("../../userscript/state/gallery-collection.ts")
        const col = collectionFor({ kind: "list", tags: "test", pid: 0 })

        await ensurePage(col, 0)
        await ensurePage(col, 42)
        await ensurePage(col, 84)

        expect(col.pages.map((page) => page.pid)).toEqual([0, 42])
        expect(col.lastPagePID).toBe(42)
    })

    it("deduplicates concurrent requests for the same page", async () => {
        api.fetchPostList.mockResolvedValue({ posts: [post(1)], lastPagePID: 0, tags: [] })
        const { collectionFor, ensurePage } =
            await import("../../userscript/state/gallery-collection.ts")
        const col = collectionFor({ kind: "list", tags: undefined, pid: 0 })
        api.fetchPostList.mockClear() // ignore the post-list route's module-load fetch

        const first = ensurePage(col, 0)
        const second = ensurePage(col, 0)

        expect(second).toBe(first)
        await first
        expect(api.fetchPostList).toHaveBeenCalledOnce()
    })

    it("updates the serialized origin pid when stepping onto another loaded page", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                posts: pid === 0 ? [post(1), post(2)] : [post(3), post(4)],
                lastPagePID: 42,
                tags: [],
            }),
        )
        const collectionModule = await import("../../userscript/state/gallery-collection.ts")
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        const col = collectionModule.collectionFor(origin)
        await collectionModule.ensurePage(col, 0)
        await collectionModule.ensurePage(col, 42)

        const { route } = await import("../../userscript/router.ts")
        route.val = { type: "postdetails", id: 2, tags: "test", origin }
        const { step } = await import("../../userscript/state/gallery.ts")
        step(1)

        expect(route.val).toEqual({
            type: "postdetails",
            id: 3,
            tags: "test",
            origin: { kind: "list", tags: "test", pid: 42 },
        })
        expect(window.location.search).toContain("pid=42")
    })
})

import van from "vanjs-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Post } from "../../userscript/api/post-list.ts"
import { flushVan, resetDom } from "../dom.ts"

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

    it("leaves modified arrows to the browser's history navigation", async () => {
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
        // Importing the module installs the document keydown listener.
        await import("../../userscript/state/gallery.ts")

        const press = (key: string, init: Record<string, unknown> = {}) => {
            const event = new Event("keydown", { bubbles: true, cancelable: true })
            Object.assign(event, { key, ...init })
            document.dispatchEvent(event)
            return event
        }

        // The modified key is left for the browser.
        const modified = press("ArrowRight", { ctrlKey: true })
        expect(route.val).toEqual({ type: "postdetails", id: 2, tags: "test", origin })
        expect(modified.defaultPrevented).toBe(false)

        // The unmodified arrow still steps: the listener is live and the
        // guard is what bailed.
        press("ArrowRight")
        expect(route.val).toEqual({
            type: "postdetails",
            id: 3,
            tags: "test",
            origin: { kind: "list", tags: "test", pid: 42 },
        })
    })

    it("deduplicates a post that the feed shift put into two pages", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                // The feed shifted between the two fetches: page 42's window
                // starts inside page 0's id range, so posts 2 and 3 repeat.
                posts: pid === 0 ? [post(1), post(2), post(3)] : [post(2), post(3), post(4)],
                lastPagePID: 42,
                tags: [],
            }),
        )
        const collectionModule = await import("../../userscript/state/gallery-collection.ts")
        const col = collectionModule.collectionFor({ kind: "list", tags: "test", pid: 0 })

        await collectionModule.ensurePage(col, 0)
        await collectionModule.ensurePage(col, 42)

        const loaded = collectionModule.loadedPosts(col)
        expect(loaded.map((entry) => entry.post.id)).toEqual([1, 2, 3, 4])
        // The repeat keeps the first page's copy (and its pid for the links).
        expect(loaded.map((entry) => entry.pid)).toEqual([0, 0, 0, 42])
    })

    it("lands a boundary step on the first unseen post of a shifted page", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                // Posts 2 and 3 repeat on page 42: the boundary post (2) is
                // already in the strip, so the step must skip past it.
                posts: pid === 0 ? [post(1), post(2), post(3)] : [post(2), post(3), post(4)],
                lastPagePID: 42,
                tags: [],
            }),
        )
        const collectionModule = await import("../../userscript/state/gallery-collection.ts")
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        const col = collectionModule.collectionFor(origin)
        await collectionModule.ensurePage(col, 0)

        const { route } = await import("../../userscript/router.ts")
        route.val = { type: "postdetails", id: 3, tags: "test", origin }
        const { step } = await import("../../userscript/state/gallery.ts")
        step(1)
        await flushVan()

        expect(route.val).toEqual({
            type: "postdetails",
            id: 4,
            tags: "test",
            origin: { kind: "list", tags: "test", pid: 42 },
        })
    })

    it("keeps fetching past a fully duplicated boundary page", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                // The feed shifted a full page: page 42 repeats page 0
                // entirely, so the fresh post only appears on page 84.
                posts: pid === 84 ? [post(2)] : [post(1)],
                lastPagePID: 84,
                tags: [],
            }),
        )
        const collectionModule = await import("../../userscript/state/gallery-collection.ts")
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        const col = collectionModule.collectionFor(origin)
        await collectionModule.ensurePage(col, 0)

        const { route } = await import("../../userscript/router.ts")
        route.val = { type: "postdetails", id: 1, tags: "test", origin }
        const { step } = await import("../../userscript/state/gallery.ts")
        step(1)
        await flushVan()

        expect(route.val).toEqual({
            type: "postdetails",
            id: 2,
            tags: "test",
            origin: { kind: "list", tags: "test", pid: 84 },
        })
    })
})

describe("finding the active post after the origin page loads", () => {
    beforeEach(() => {
        vi.resetModules()
        api.fetchFavorites.mockReset()
        api.fetchPostList.mockReset()
        resetDom()
    })

    // Import the reactive modules against the initial (post list) route, so
    // the only loads the tests trigger are their own. The list loader's
    // module-load fetch is dropped with the clear below.
    async function loadModules() {
        const collectionModule = await import("../../userscript/state/gallery-collection.ts")
        const { route } = await import("../../userscript/router.ts")
        const galleryModule = await import("../../userscript/state/gallery.ts")
        api.fetchPostList.mockClear()
        return {
            collectionModule,
            route,
            galleryModule,
            origin: { kind: "list" as const, tags: "test", pid: 0 },
        }
    }

    it("loads following pages until the active post is found", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                posts: pid === 0 ? [post(1), post(2)] : [post(3), post(4)],
                lastPagePID: 42,
                tags: [],
            }),
        )
        const { collectionModule, route, galleryModule, origin } = await loadModules()
        route.val = { type: "postdetails", id: 4, tags: "test", origin }
        await flushVan()

        // Origin page 0 plus one follow-up: the page the post drifted onto.
        expect(api.fetchPostList.mock.calls.map((call) => call[1])).toEqual([0, 42])
        const col = collectionModule.getCollection()
        expect(col?.pages.map((page) => page.pid)).toEqual([0, 42])
        // The arrows are live again: the post sits at the collection's end.
        expect(galleryModule.canStep(-1)).toBe(true)
        expect(galleryModule.canStep(1)).toBe(false)
        expect(galleryModule.gallery.val.status).toBe("ready")
    })

    it("keeps the pages loaded while searching in the collection", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                // The active post is two pages down: the intermediate page
                // settles before the one that holds it.
                posts: pid === 84 ? [post(5), post(4), post(3)] : [post(1), post(2)],
                lastPagePID: 84,
                tags: [],
            }),
        )
        const { collectionModule, route, origin } = await loadModules()
        route.val = { type: "postdetails", id: 4, tags: "test", origin }
        await flushVan()

        // The intermediate page is kept, not discarded: the filmstrip shows
        // the whole path from the origin page to the post.
        const col = collectionModule.getCollection()
        expect(col?.pages.map((page) => page.pid)).toEqual([0, 42, 84])
    })

    it("stops searching after the page limit", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({ posts: [post(1)], lastPagePID: pid, tags: [] }),
        )
        const { route, origin } = await loadModules()
        route.val = { type: "postdetails", id: 999, tags: "test", origin }
        await flushVan()

        // Origin page plus the ten follow-ups, nothing more.
        expect(api.fetchPostList.mock.calls.map((call) => call[1])).toEqual([
            0, 42, 84, 126, 168, 210, 252, 294, 336, 378, 420,
        ])
    })

    it("stops the search at an empty page", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                posts: pid === 0 ? [post(1)] : [],
                lastPagePID: 0,
                tags: [],
            }),
        )
        const { collectionModule, route, origin } = await loadModules()
        route.val = { type: "postdetails", id: 999, tags: "test", origin }
        await flushVan()

        expect(api.fetchPostList.mock.calls.map((call) => call[1])).toEqual([0, 42])
        const col = collectionModule.getCollection()
        expect(col?.pages.map((page) => page.pid)).toEqual([0])
        expect(col?.lastPagePID).toBe(0)
    })

    it("searches without a loading flash when the origin page is cached", async () => {
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                posts: pid === 0 ? [post(1), post(2)] : [post(3)],
                lastPagePID: 42,
                tags: [],
            }),
        )
        const { route, galleryModule, origin } = await loadModules()
        route.val = { type: "postdetails", id: 1, tags: "test", origin }
        await flushVan()
        // The post was on the origin page: no follow-up fetches.
        expect(api.fetchPostList.mock.calls.map((call) => call[1])).toEqual([0])
        api.fetchPostList.mockClear()

        // Another post of the same origin that is not on the loaded pages:
        // the origin page is cached, so the load must skip the skeleton.
        // Track every status the gallery state passes through — a sync check
        // right after the route change would run before van processes it, and
        // after the flush the loading state would already be gone again.
        const statuses: string[] = []
        van.derive(() => statuses.push(galleryModule.gallery.val.status))
        route.val = { type: "postdetails", id: 3, tags: "test", origin }
        await flushVan()

        expect(statuses).not.toContain("loading")
        expect(api.fetchPostList.mock.calls.map((call) => call[1])).toEqual([42])
    })

    it("stops the search when the route leaves the gallery", async () => {
        // The gallery's origin fetch is deferred so the test can move the
        // route while the page is still in flight, then settle it.
        let settleOrigin: ((posts: Post[]) => void) | undefined
        api.fetchPostList.mockImplementation(
            (tags: string | undefined, pid: number) =>
                new Promise((resolve) => {
                    if (tags === "test" && pid === 0)
                        settleOrigin = (posts) => resolve({ posts, lastPagePID: 0, tags: [] })
                    else resolve({ posts: [post(1)], lastPagePID: 0, tags: [] })
                }),
        )
        const { route, origin } = await loadModules()
        route.val = { type: "postdetails", id: 999, tags: "test", origin }
        await flushVan()
        // Leave while the origin fetch is still in flight.
        route.val = { type: "unknown" }
        await flushVan()
        // Settle the in-flight page: the search must not start.
        settleOrigin?.([post(1)])
        await flushVan()

        // Only the origin page was loaded; the search never started.
        expect(api.fetchPostList.mock.calls.map((call) => call[1])).toEqual([0])
    })
})

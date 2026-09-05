import { afterEach, describe, expect, it, vi } from "vitest"

import { type PostList } from "../../src/api/post-list.ts"
import { clearWindowListeners, flushVan, resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

// The list's network function is mocked; the state module (including its
// replay cache) stays real.
const postListApi = vi.hoisted(() => ({ fetchPostList: vi.fn() }))

vi.mock("../../src/api/post-list.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/api/post-list.ts")>()
    return { ...actual, fetchPostList: postListApi.fetchPostList }
})

const LIST_URL = "https://rule34.xxx/index.php?page=post&s=list"

// A one-post page whose post encodes the page (100 + pid), so a wrong
// payload is obvious.
function page(pid: number): PostList {
    const id = 100 + pid
    return {
        posts: [
            {
                id,
                link: `/index.php?page=post&s=view&id=${id}`,
                thumbnail: `//cdn.example/${id}.jpg`,
                tags: [],
            },
        ],
        lastPagePID: 126,
        tags: [],
    }
}

function toDetails(id: number) {
    return {
        type: "postdetails",
        id,
        tags: undefined,
        origin: { kind: "list", tags: undefined, pid: 0 },
    } as const
}

// A fresh module graph (the list state and the replay cache are module local)
// with the list's 30-second replay TTL under a controllable clock.
async function fresh() {
    resetDom(LIST_URL)
    vi.resetModules()
    let now = Date.now()
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const [listMod, routerMod] = await Promise.all([
        import("../../src/state/list.ts"),
        import("../../src/router.ts"),
    ])
    await flushVan()
    return {
        list: listMod.list,
        listLoading: listMod.listLoading,
        navigate: routerMod.navigate,
        advance: (ms: number) => {
            now += ms
        },
    }
}

afterEach(() => {
    vi.restoreAllMocks()
    clearWindowListeners()
})

describe("list replay cache", () => {
    it("replays a fresh page on back without re-fetching", async () => {
        postListApi.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve(page(pid)),
        )
        const ctx = await fresh()
        expect(postListApi.fetchPostList).toHaveBeenCalledTimes(1)
        expect(ctx.list.val).toMatchObject({ status: "ready", pid: 0, posts: [{ id: 100 }] })

        ctx.navigate(toDetails(100))
        await flushVan()
        history.back()
        await flushVan()

        // No second fetch: the back navigation replayed the fresh payload.
        expect(postListApi.fetchPostList).toHaveBeenCalledTimes(1)
        expect(ctx.listLoading.val).toBe(false)
        expect(ctx.list.val).toMatchObject({ status: "ready", pid: 0, posts: [{ id: 100 }] })
    })

    it("replays the previous page when back returns from a page turn", async () => {
        postListApi.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve(page(pid)),
        )
        const ctx = await fresh()

        ctx.navigate({ type: "postlist", tags: undefined, pid: 42 })
        await flushVan()
        expect(ctx.list.val).toMatchObject({ pid: 42, posts: [{ id: 142 }] })

        history.back()
        await flushVan()

        expect(ctx.list.val).toMatchObject({ pid: 0, posts: [{ id: 100 }] })
        // No third fetch: the back navigation replayed the fresh p0 payload.
        expect(postListApi.fetchPostList).toHaveBeenCalledTimes(2)
    })

    it("shows the stale page immediately while its revalidation settles", async () => {
        const revalidate = deferred<PostList>()
        let calls = 0
        postListApi.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) => {
            calls += 1
            return calls === 1 ? Promise.resolve(page(0)) : revalidate.promise
        })
        const ctx = await fresh()
        ctx.advance(31_000) // the p0 entry is now older than the replay TTL
        ctx.navigate(toDetails(100))
        await flushVan()

        history.back()
        await flushVan()

        // The stale page is already on screen, and the revalidation is
        // running in the background.
        expect(ctx.list.val).toMatchObject({ status: "ready", pid: 0, posts: [{ id: 100 }] })
        expect(ctx.listLoading.val).toBe(true)
        expect(postListApi.fetchPostList).toHaveBeenCalledTimes(2)

        const onScreen = ctx.list.val
        revalidate.resolve(page(0)) // same posts as on screen
        await flushVan()

        // The settle revalidates invisibly: the state object is untouched,
        // so the grid does not re-render.
        expect(ctx.listLoading.val).toBe(false)
        expect(ctx.list.val).toBe(onScreen)
    })

    it("applies a revalidation whose posts changed", async () => {
        const revalidate = deferred<PostList>()
        let calls = 0
        postListApi.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) => {
            calls += 1
            return calls === 1 ? Promise.resolve(page(0)) : revalidate.promise
        })
        const ctx = await fresh()
        ctx.advance(31_000)
        ctx.navigate(toDetails(100))
        await flushVan()

        history.back()
        await flushVan()

        const shifted = page(0)
        shifted.posts.unshift({
            id: 999,
            link: "/index.php?page=post&s=view&id=999",
            thumbnail: "//cdn.example/999.jpg",
            tags: [],
        })
        revalidate.resolve(shifted)
        await flushVan()

        expect(ctx.listLoading.val).toBe(false)
        expect(ctx.list.val).toMatchObject({
            status: "ready",
            pid: 0,
            posts: [{ id: 999 }, { id: 100 }],
        })
    })

    it("falls back to a normal load when a page fell out of the replay cache", async () => {
        postListApi.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve(page(pid)),
        )
        const ctx = await fresh()

        // Six pages were loaded; the cache keeps the last five, so p0 evicted.
        for (const pid of [42, 84, 126, 168, 210]) {
            ctx.navigate({ type: "postlist", tags: undefined, pid })
            await flushVan()
        }
        expect(postListApi.fetchPostList).toHaveBeenCalledTimes(6)

        for (let i = 0; i < 6; i += 1) {
            history.back()
            await flushVan()
        }

        expect(ctx.list.val).toMatchObject({ status: "ready", pid: 0, posts: [{ id: 100 }] })
        // p0 had to be fetched again; the other five pages replayed.
        expect(postListApi.fetchPostList).toHaveBeenCalledTimes(7)
    })
})

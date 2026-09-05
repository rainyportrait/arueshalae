import van from "vanjs-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { type Loadable } from "../../userscript/state/load.ts"
import { flushVan, resetDom } from "../dom.ts"
import { fixture } from "../helpers/fixture.ts"

type Payload = { value: string }

const LIST_URL = "https://rule34.xxx/index.php?page=post&s=list"
const SETTINGS_URL = "https://rule34.xxx/index.php?page=account&s=options"

// `routeLoader` binds to the router (and, via the seed, the live document) at
// import time, so each test resets the module graph and the test URL, then
// imports both fresh and wires up a standalone loader.
async function makeLoader(initialUrl: string, seedImpl?: () => Payload | null) {
    resetDom(initialUrl)
    const [{ routeLoader }, { route }] = await Promise.all([
        import("../../userscript/state/load.ts"),
        import("../../userscript/router.ts"),
    ])
    const state = van.state<Loadable<Payload>>({ status: "loading" })
    const fetcher = vi.fn(() => Promise.resolve({ value: "fetched" }))
    const seed = vi.fn(seedImpl ?? (() => ({ value: "seeded" })))
    const { pending, reload } = routeLoader(state, "postlist", fetcher, seed)
    return { state, fetcher, seed, pending, reload, route }
}

describe("routeLoader initial seed", () => {
    beforeEach(() => {
        vi.resetModules()
    })

    it("seeds from the live document instead of fetching when the initial route matches", async () => {
        const { state, fetcher, seed, pending } = await makeLoader(LIST_URL)

        expect(seed).toHaveBeenCalledOnce()
        expect(fetcher).not.toHaveBeenCalled()
        expect(pending.val).toBe(false)
        expect(state.val).toEqual({ status: "ready", value: "seeded" })
    })

    it("fetches when the initial route is a different type, and never seeds", async () => {
        const { state, fetcher, seed, route } = await makeLoader(SETTINGS_URL)

        expect(seed).not.toHaveBeenCalled()
        expect(fetcher).not.toHaveBeenCalled()

        route.val = { type: "postlist", tags: undefined, pid: 0 }
        await flushVan()

        expect(seed).not.toHaveBeenCalled()
        expect(fetcher).toHaveBeenCalledOnce()
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })

    it("fetches again on later navigations and never re-seeds", async () => {
        const { state, fetcher, seed, route } = await makeLoader(LIST_URL)
        expect(state.val).toEqual({ status: "ready", value: "seeded" })

        route.val = { type: "postlist", tags: "other", pid: 0 }
        await flushVan()

        expect(seed).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledOnce()
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })

    it("falls back to the network when the seed throws on unexpected markup", async () => {
        const { state, fetcher, seed } = await makeLoader(LIST_URL, () => {
            throw new Error("unexpected markup")
        })

        expect(seed).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledOnce()
        await flushVan()
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })

    it("falls back to the network when the seed reports the document is not this page", async () => {
        const { state, fetcher, seed } = await makeLoader(LIST_URL, () => null)

        expect(seed).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledOnce()
        await flushVan()
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })

    it("skips the seed on a challenge page and fetches", async () => {
        const { state, fetcher, seed } = await makeLoader(`${LIST_URL}&__cf_chl_rt_tk=sentinel`)
        await flushVan()

        expect(seed).not.toHaveBeenCalled()
        expect(fetcher).toHaveBeenCalledOnce()
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })

    it("still allows a forced reload to fetch after seeding", async () => {
        const { state, fetcher, seed, reload } = await makeLoader(LIST_URL)
        expect(seed).toHaveBeenCalledOnce()

        reload()
        await flushVan()

        expect(seed).toHaveBeenCalledOnce()
        expect(fetcher).toHaveBeenCalledOnce()
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })
})

// The real post list seed against the fixture: the network function is
// mocked (everything else in the module stays real) so a broken seed fails
// the test loudly instead of reaching the network.
const postListApi = vi.hoisted(() => ({ fetchPostList: vi.fn() }))

vi.mock("../../userscript/api/post-list.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../userscript/api/post-list.ts")>()
    return { ...actual, fetchPostList: postListApi.fetchPostList }
})

describe("post list initial seed", () => {
    beforeEach(() => {
        vi.resetModules()
        postListApi.fetchPostList.mockReset()
    })

    it("seeds the list state from the live document instead of fetching", async () => {
        resetDom(`${LIST_URL}&tags=odd_tag`)
        // A server-rendered list page in the live document.
        const fixtureDoc = fixture("post-list.html")
        for (const child of [...fixtureDoc.body.childNodes]) {
            document.body.appendChild(child.cloneNode(true))
        }

        const { list } = await import("../../userscript/state/list.ts")

        expect(postListApi.fetchPostList).not.toHaveBeenCalled()
        expect(list.val).toEqual({
            status: "ready",
            posts: [
                {
                    id: 101,
                    link: "/index.php?page=post&s=view&id=101&tags=odd_tag",
                    thumbnail: "//cdn.example/101.jpg",
                    tags: ["odd_tag", "animated_gif"],
                },
            ],
            lastPagePID: 84,
            tags: [
                { name: "Some Character", slug: "some_character", type: "character", count: 9876 },
            ],
            pid: 0,
            query: "odd_tag",
        })
    })

    it("fetches when the live document carries no list page (bare site root)", async () => {
        postListApi.fetchPostList.mockResolvedValue({ posts: [], lastPagePID: 0, tags: [] })
        resetDom(LIST_URL)

        const { list } = await import("../../userscript/state/list.ts")

        expect(postListApi.fetchPostList).toHaveBeenCalledOnce()
        await flushVan()
        expect(list.val).toEqual({
            status: "ready",
            posts: [],
            lastPagePID: 0,
            tags: [],
            pid: 0,
            query: undefined,
        })
    })
})

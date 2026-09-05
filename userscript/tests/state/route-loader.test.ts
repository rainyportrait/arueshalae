import van from "vanjs-core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { type Loadable, type Replay } from "../../src/state/load.ts"
import { clearWindowListeners, flushVan, resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"
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
        import("../../src/state/load.ts"),
        import("../../src/router.ts"),
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
    afterEach(clearWindowListeners)

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

vi.mock("../../src/api/post-list.ts", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../src/api/post-list.ts")>()
    return { ...actual, fetchPostList: postListApi.fetchPostList }
})

describe("post list initial seed", () => {
    beforeEach(() => {
        vi.resetModules()
        postListApi.fetchPostList.mockReset()
    })
    afterEach(clearWindowListeners)

    it("seeds the list state from the live document instead of fetching", async () => {
        resetDom(`${LIST_URL}&tags=odd_tag`)
        // A server-rendered list page in the live document.
        const fixtureDoc = fixture("post-list.html")
        for (const child of [...fixtureDoc.body.childNodes]) {
            document.body.appendChild(child.cloneNode(true))
        }

        const { list } = await import("../../src/state/list.ts")

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

        const { list } = await import("../../src/state/list.ts")

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

// A small replay source standing in for the list's: a plain map plus the
// freshness and sameness hooks the loader is being tested for.
function makeReplaySource(freshFor: number): Replay<Payload, "postlist"> {
    const map = new Map<string, { at: number; data: Payload }>()
    return {
        key: (r) => `${r.pid}\u0000${r.tags ?? ""}`,
        get: (key) => map.get(key),
        set: (key, data) => {
            map.delete(key)
            map.set(key, { at: Date.now(), data })
        },
        freshFor,
        same: (a, b) => a.value === b.value,
    }
}

async function makeReplayLoader(
    initialUrl: string,
    freshFor: number,
    fetchImpl: (calls: number) => Promise<Payload>,
) {
    resetDom(initialUrl)
    const [{ routeLoader }, { route }] = await Promise.all([
        import("../../src/state/load.ts"),
        import("../../src/router.ts"),
    ])
    const state = van.state<Loadable<Payload>>({ status: "loading" })
    let calls = 0
    const fetcher = vi.fn(() => fetchImpl(++calls))
    const { pending, reload } = routeLoader(
        state,
        "postlist",
        fetcher,
        undefined,
        makeReplaySource(freshFor),
    )
    return { state, fetcher, pending, reload, route }
}

describe("routeLoader replay", () => {
    beforeEach(() => {
        vi.resetModules()
    })
    afterEach(clearWindowListeners)

    it("replays a fresh cached page without fetching", async () => {
        const { state, fetcher, pending, route } = await makeReplayLoader(LIST_URL, 1e9, () =>
            Promise.resolve({ value: "fetched" }),
        )
        await flushVan()
        expect(fetcher).toHaveBeenCalledTimes(1)

        route.val = { type: "postdetails", id: 1, tags: undefined, origin: undefined }
        await flushVan()
        route.val = { type: "postlist", tags: undefined, pid: 0 }
        await flushVan()

        // The back navigation found its own payload in the replay cache: no
        // second fetch, no pending flag, and the state shows it.
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(pending.val).toBe(false)
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })

    it("replays a stale page and applies a revalidation that changed it", async () => {
        const { state, fetcher, pending, route } = await makeReplayLoader(LIST_URL, 0, (n) =>
            Promise.resolve({ value: `f${n}` }),
        )
        await flushVan()
        route.val = { type: "postlist", tags: undefined, pid: 42 }
        await flushVan()
        expect(state.val).toEqual({ status: "ready", value: "f2" })

        route.val = { type: "postlist", tags: undefined, pid: 0 }
        await flushVan()

        // The stale page replayed instantly (the state showed f1 again) and
        // the background revalidation published its changed payload.
        expect(fetcher).toHaveBeenCalledTimes(3)
        expect(pending.val).toBe(false)
        expect(state.val).toEqual({ status: "ready", value: "f3" })
    })

    it("keeps the on-screen payload when a revalidation settles unchanged", async () => {
        const revalidate = deferred<Payload>()
        const { state, fetcher, pending, route } = await makeReplayLoader(LIST_URL, 0, (n) =>
            n === 1
                ? Promise.resolve({ value: "p0" })
                : n === 2
                  ? Promise.resolve({ value: "p42" })
                  : revalidate.promise,
        )
        await flushVan()
        route.val = { type: "postlist", tags: undefined, pid: 42 }
        await flushVan()
        route.val = { type: "postlist", tags: undefined, pid: 0 }
        await flushVan()
        // The stale page is on screen again; its revalidation is in flight.
        const onScreen = state.val
        expect(onScreen).toEqual({ status: "ready", value: "p0" })
        expect(pending.val).toBe(true)
        expect(fetcher).toHaveBeenCalledTimes(3)

        revalidate.resolve({ value: "p0" }) // same payload as on screen
        await flushVan()

        // The settle revalidates invisibly: the state object is untouched,
        // so nothing re-renders.
        expect(pending.val).toBe(false)
        expect(state.val).toBe(onScreen)
    })

    it("discards an in-flight fetch when a replay settles instantly", async () => {
        const first = deferred<Payload>()
        const second = deferred<Payload>()
        const { state, fetcher, pending, route } = await makeReplayLoader(LIST_URL, 1e9, (n) =>
            n === 1 ? first.promise : second.promise,
        )
        first.resolve({ value: "p0" })
        await flushVan()
        route.val = { type: "postlist", tags: undefined, pid: 42 }
        await flushVan()
        expect(pending.val).toBe(true) // the p42 fetch is in flight

        route.val = { type: "postlist", tags: undefined, pid: 0 }
        await flushVan()
        second.resolve({ value: "p42" })
        await flushVan()

        // The replay of p0 cancelled the p42 fetch: its late result must not
        // clobber the replayed page, and the loading flag is clear.
        expect(state.val).toEqual({ status: "ready", value: "p0" })
        expect(pending.val).toBe(false)
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it("fetches on a forced reload even for a fresh page", async () => {
        const { state, fetcher, pending, reload } = await makeReplayLoader(LIST_URL, 1e9, () =>
            Promise.resolve({ value: "fetched" }),
        )
        await flushVan()

        reload()
        await flushVan()

        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(pending.val).toBe(false)
        expect(state.val).toEqual({ status: "ready", value: "fetched" })
    })
})

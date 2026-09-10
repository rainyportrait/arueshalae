import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
    getPendingPostIds,
    getPostStatuses,
    observePost,
    setFavoriteMembership,
    setPostAvailability,
} from "../../src/api/library.ts"
import type { PostDetails } from "../../src/api/post-details.ts"
import {
    type MediaFetcher,
    ServerError,
    checkDownloads,
    getDownloadCount,
    mediaUrlFor,
    savePostToServer,
} from "../../src/api/server.ts"
import { getSyncBaseline, getSyncStatus, reconcileFavorites } from "../../src/api/sync.ts"
import type { Tag } from "../../src/api/tags.ts"
import { resetDom } from "../dom.ts"

vi.mock("../../src/state/auth.ts", () => ({
    auth: { rawVal: { status: "authenticated", userId: 7 } },
}))

// The client goes through the global fetch; a stub stands in so no request
// ever leaves the process.
type FetchCall = { url: string; init: RequestInit }

function mockFetch(
    calls: FetchCall[],
    respond: (url: string | URL, init: RequestInit) => Response,
): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init: RequestInit): Promise<Response> => {
            calls.push({ url: url.toString(), init })
            return respond(url, init)
        }),
    )
}

function jsonResponse(payload: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => payload,
    } as Response
}

describe("server client", () => {
    let calls: FetchCall[]

    beforeEach(() => {
        resetDom()
        calls = []
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("gets the held ids from /api/posts/downloaded?ids= and returns them", async () => {
        mockFetch(calls, () => jsonResponse({ postIds: [3] }))

        await expect(checkDownloads([1, 2, 3])).resolves.toEqual(new Set([3]))

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/posts/downloaded?ids=1,2,3")
        expect(calls[0]?.init.method).toBeUndefined()
        expect(calls[0]?.init.body).toBeUndefined()
    })

    it("skips the request entirely when given no ids", async () => {
        mockFetch(calls, () => jsonResponse({ postIds: [] }))

        await expect(checkDownloads([])).resolves.toEqual(new Set())
        expect(calls).toHaveLength(0)
    })

    it("reads sync state and the ordered baseline from descriptive GET routes", async () => {
        mockFetch(calls, (url) =>
            jsonResponse(
                url.toString().endsWith("/baseline")
                    ? { ids: [3, 2], initialized: true, countOffset: 0, revision: 4 }
                    : {
                          favorites: 2,
                          pending: 1,
                          initialized: true,
                          countOffset: 0,
                          lastSyncAt: 9,
                      },
            ),
        )

        await expect(getSyncStatus()).resolves.toMatchObject({ favorites: 2, pending: 1 })
        await expect(getSyncBaseline()).resolves.toMatchObject({ ids: [3, 2], revision: 4 })
        expect(calls.map((call) => call.url)).toEqual([
            "http://127.0.0.1:34343/api/sync/status",
            "http://127.0.0.1:34343/api/sync/baseline",
        ])
    })

    it("publishes reconciliation to its typed route", async () => {
        mockFetch(calls, () => jsonResponse({ ok: true }))
        const body = { ids: [3, 2], deleted: [1], reportedCount: 2, revision: 4 }

        await reconcileFavorites(body)

        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/sync/reconcile")
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual(body)
    })

    it("reads post status and pending IDs from their GET routes", async () => {
        mockFetch(calls, (url) =>
            jsonResponse(url.toString().includes("/status?") ? { posts: [] } : { postIds: [7] }),
        )

        await expect(getPostStatuses([1, 2])).resolves.toEqual([])
        await expect(getPendingPostIds()).resolves.toEqual([7])
        expect(calls.map((call) => call.url)).toEqual([
            "http://127.0.0.1:34343/api/posts/status?ids=1%2C2",
            "http://127.0.0.1:34343/api/posts/pending",
        ])
    })

    it("reports the current post-page tags as an observation", async () => {
        mockFetch(calls, () => jsonResponse({ observed: true }))

        await observePost(makePost())

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/posts/123/observation")
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
            score: 0,
            tags: [
                { name: "tree_bark", kind: "artist" },
                { name: "1boy", kind: "character" },
            ],
        })
    })

    it("survives an all-absent answer with an empty set", async () => {
        mockFetch(calls, () => jsonResponse({ postIds: [] }))

        await expect(checkDownloads([1])).resolves.toEqual(new Set())
    })

    it("throws ServerError when the server is unreachable", async () => {
        mockFetch(calls, () => {
            throw new TypeError("fetch failed")
        })

        await expect(checkDownloads([1])).rejects.toBeInstanceOf(ServerError)
    })

    it("throws ServerError on a non-2xx answer", async () => {
        mockFetch(
            calls,
            () => ({ ok: false, status: 500, statusText: "Internal Server Error" }) as Response,
        )

        await expect(checkDownloads([1])).rejects.toThrow("500")
    })

    it("throws ServerError without a configured URL", async () => {
        const { serverSettings } = await import("../../src/state/settings.ts")
        const previous = serverSettings.val
        serverSettings.val = { enabled: true, url: "" }
        mockFetch(calls, () => jsonResponse({}))

        try {
            await expect(checkDownloads([1])).rejects.toBeInstanceOf(ServerError)
            expect(calls).toHaveLength(0)
        } finally {
            serverSettings.val = previous
        }
    })

    it("reads the download count for the settings-page connection test", async () => {
        mockFetch(calls, () => jsonResponse({ count: 42 }))

        await expect(getDownloadCount()).resolves.toBe(42)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/posts/count")
    })

    it("marks membership unfavorited through the post endpoint", async () => {
        mockFetch(calls, () => jsonResponse({ ok: true }))

        await expect(setFavoriteMembership(123, false)).resolves.toBeUndefined()

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/posts/123/membership")
        expect(calls[0]?.init.method).toBe("POST")
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ membership: "unfavorited" })
    })

    it("sends the up-to-date score when marking membership favorited", async () => {
        mockFetch(calls, () => jsonResponse({ ok: true }))

        await setFavoriteMembership(123, true, -4)

        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
            membership: "favorited",
            score: -4,
        })
    })

    it("throws ServerError when the membership update fails", async () => {
        mockFetch(
            calls,
            () => ({ ok: false, status: 500, statusText: "Internal Server Error" }) as Response,
        )

        await expect(setFavoriteMembership(123, false)).rejects.toBeInstanceOf(ServerError)
    })

    it("reports availability separately from post observation", async () => {
        mockFetch(calls, () => jsonResponse({ ok: true }))

        await setPostAvailability(123, "deleted")

        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/posts/123/availability")
        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ availability: "deleted" })
    })
})

// --- Saving posts -----------------------------------------------------------

function makePost(overrides: Partial<PostDetails> = {}): PostDetails {
    return {
        id: 123,
        title: "test post",
        media: {
            kind: "image",
            src: "https://rule34.xxx/img/2025/sample_123.jpg",
            originalImage: "https://wimg.rule34.xxx/img/2025/123.jpg",
            width: 700,
            height: 874,
        },
        posted: "",
        poster: "",
        posterHref: "",
        source: "",
        sourceHref: "",
        rating: "",
        score: 0,
        tags: [
            { name: "Tree Bark", slug: "tree_bark", type: "artist", count: 10 },
            { name: "1boy", slug: "1boy", type: "character", count: 5 },
        ],
        ...overrides,
    }
}

describe("mediaUrlFor", () => {
    it("prefers the original image over the displayed sample", () => {
        expect(mediaUrlFor(makePost().media)).toBe("https://wimg.rule34.xxx/img/2025/123.jpg")
    })

    it("falls back to the displayed src when the original link is missing", () => {
        const post = makePost()
        post.media = { ...post.media, kind: "image", originalImage: "" }
        expect(mediaUrlFor(post.media)).toBe("https://rule34.xxx/img/2025/sample_123.jpg")
    })

    it("uses the video src for video posts", () => {
        const post = makePost()
        post.media = {
            kind: "video",
            src: "https://aws-mp4.rule34.xxx/2025/123.mp4",
            poster: "https://wimg.rule34.xxx/posters/123.jpg",
            width: 0,
            height: 0,
        }
        expect(mediaUrlFor(post.media)).toBe("https://aws-mp4.rule34.xxx/2025/123.mp4")
    })
})

describe("savePostToServer", () => {
    let calls: FetchCall[]

    beforeEach(() => {
        calls = []
    })

    it("uploads the original image and post tags", async () => {
        const bytes = new Uint8Array([1, 2, 3, 4])
        const fetchMedia = vi.fn<MediaFetcher>(async (url) => bytes.buffer)
        mockFetch(calls, () => jsonResponse({ ok: true }))

        await savePostToServer(makePost(), fetchMedia, 1000)

        expect(fetchMedia).toHaveBeenCalledWith("https://wimg.rule34.xxx/img/2025/123.jpg", 1000)
        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/api/posts/123")
        expect(calls[0]?.init.method).toBe("POST")
        const body = calls[0]?.init.body as FormData
        const file = body.get("image") as File
        expect(file.name).toBe("123.jpg")
        expect(file.type).toBe("image/jpeg")
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
        expect(JSON.parse(String(body.get("tags")))).toEqual([
            { name: "tree_bark", kind: "artist" },
            { name: "1boy", kind: "character" },
        ])
    })

    it("downloads the video file for video posts", async () => {
        const fetchMedia = vi.fn<MediaFetcher>(async () => new ArrayBuffer(0))
        mockFetch(calls, () => jsonResponse({ ok: true }))
        const post = makePost()
        post.media = {
            kind: "video",
            src: "https://aws-mp4.rule34.xxx/2025/123.mp4?token=abc",
            poster: "",
            width: 0,
            height: 0,
        }

        await savePostToServer(post, fetchMedia, 1000)

        expect(fetchMedia).toHaveBeenCalledWith(
            "https://aws-mp4.rule34.xxx/2025/123.mp4?token=abc",
            1000,
        )
        const file = (calls[0]?.init.body as FormData).get("image") as File
        expect(file.name).toBe("123.mp4")
        expect(file.type).toBe("video/mp4")
    })

    it("throws when the post has no media URL", async () => {
        const post = makePost()
        post.media = { ...post.media, kind: "image", src: "", originalImage: "" }

        await expect(savePostToServer(post, vi.fn<MediaFetcher>(), 1000)).rejects.toThrow(
            "no media URL",
        )
    })

    it("throws a ServerError when the upload leg fails", async () => {
        const fetchMedia = vi.fn<MediaFetcher>(async () => new ArrayBuffer(0))
        mockFetch(calls, () => {
            throw new TypeError("fetch failed")
        })

        await expect(savePostToServer(makePost(), fetchMedia, 1000)).rejects.toBeInstanceOf(
            ServerError,
        )
    })
})

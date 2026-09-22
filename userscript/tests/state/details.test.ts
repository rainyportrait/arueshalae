import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails } from "../../src/api/post-details.ts"
import { flushVan, resetDom, testWindow } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

const api = vi.hoisted(() => ({
    fetchPostDetails: vi.fn(),
    fetchCachedPostDetails: vi.fn(),
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    observePost: vi.fn(),
    downloadKnownPost: vi.fn(),
}))

vi.mock("../../src/api/post-details.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchPostDetails: api.fetchPostDetails,
}))
vi.mock("../../src/api/server.ts", () => ({
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    fetchCachedPostDetails: api.fetchCachedPostDetails,
    ServerError: class ServerError extends Error {},
}))
vi.mock("../../src/api/library.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    observePost: api.observePost,
}))
// The details page downloads a favorite missing media on view
// (sync/download.ts); keep that upload out of the state test.
vi.mock("../../src/sync/download.ts", () => ({
    downloadKnownPost: api.downloadKnownPost,
    drainDownloads: vi.fn(),
}))

function imagePost(id: number): PostDetails {
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

function videoPost(id: number): PostDetails {
    return {
        ...imagePost(id),
        media: {
            kind: "video",
            src: `//cdn.example/${id}.webm`,
            poster: `//cdn.example/${id}.jpg`,
            width: 100,
            height: 100,
        },
    }
}

// Hold media readiness: while held, image decode() never settles, so a
// settled payload stays unpublished (state/details.ts).
function holdMediaReadiness() {
    const ready = deferred<void>()
    const original = testWindow.HTMLImageElement.prototype.decode
    testWindow.HTMLImageElement.prototype.decode = () => ready.promise
    return {
        release: () => ready.resolve(),
        restore: () => {
            testWindow.HTMLImageElement.prototype.decode = original
        },
    }
}

describe("state/details media gating", () => {
    beforeEach(() => {
        vi.resetModules()
        api.fetchPostDetails.mockReset()
        api.fetchCachedPostDetails.mockReset()
        api.checkDownloads.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("keeps the payload unpublished until the media can be shown", async () => {
        api.fetchPostDetails.mockResolvedValue(imagePost(9))
        const { details, detailsLoading, detailsMedia } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        const media = holdMediaReadiness()
        route.val = { type: "postdetails", id: 9, tags: undefined, origin: undefined }
        await flushVan()
        // The fetch settled, but the media isn't ready: nothing published,
        // and the loading bar still reads in-flight.
        expect(details.val).toEqual({ status: "loading" })
        expect(detailsLoading.val).toBe(true)
        expect(detailsMedia.rawVal?.post.id).toBe(9)
        media.release()
        await flushVan()
        expect(details.val).toMatchObject({ status: "ready", post: imagePost(9) })
        expect(detailsLoading.val).toBe(false)
        media.restore()
    })

    it("keeps a video payload unpublished until its element can play", async () => {
        api.fetchPostDetails.mockResolvedValue(videoPost(9))
        const { details, detailsLoading, detailsMedia } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        route.val = { type: "postdetails", id: 9, tags: undefined, origin: undefined }
        await flushVan()
        expect(details.val).toEqual({ status: "loading" })
        expect(detailsLoading.val).toBe(true)
        detailsMedia.rawVal?.el.dispatchEvent(new Event("canplay"))
        await flushVan()
        expect(details.val).toMatchObject({ status: "ready", post: videoPost(9) })
        expect(detailsLoading.val).toBe(false)
    })

    it("publishes a pending cached video after the upstream fetch fails", async () => {
        const { serverSettings } = await import("../../src/state/settings.ts")
        serverSettings.val = { ...serverSettings.val, enabled: true }
        api.fetchCachedPostDetails.mockResolvedValue(videoPost(9))
        const upstream = deferred<PostDetails>()
        api.fetchPostDetails.mockReturnValue(upstream.promise)
        const { details, detailsLoading, detailsMedia } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        route.val = { type: "postdetails", id: 9, tags: undefined, origin: undefined }
        await flushVan()
        // The cached video is parked (in the hidden preloader) while the
        // upstream settles.
        const slot = detailsMedia.rawVal
        expect(slot?.post.id).toBe(9)
        expect(slot!.el.parentElement).not.toBeNull()
        upstream.reject(new Error("nope"))
        await flushVan()
        // The upstream failed before the media was ready, but the cached
        // copy can still become the visible post.
        expect(details.val).toEqual({ status: "loading" })
        expect(detailsLoading.val).toBe(true)
        expect(detailsMedia.rawVal).toBe(slot)
        slot!.el.dispatchEvent(new Event("canplay"))
        await flushVan()
        expect(details.val).toMatchObject({ status: "ready", post: videoPost(9) })
        expect(detailsLoading.val).toBe(false)
    })

    it("removes a parked cached video as soon as upstream media supersedes it", async () => {
        const { serverSettings } = await import("../../src/state/settings.ts")
        serverSettings.val = { ...serverSettings.val, enabled: true }
        api.fetchCachedPostDetails.mockResolvedValue(videoPost(9))
        const upstream = deferred<PostDetails>()
        api.fetchPostDetails.mockReturnValue(upstream.promise)
        const { details, detailsMedia } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        route.val = { type: "postdetails", id: 9, tags: undefined, origin: undefined }
        await flushVan()
        const cachedSlot = detailsMedia.rawVal
        expect(cachedSlot?.el.parentElement).not.toBeNull()
        upstream.resolve(imagePost(9))
        await flushVan()
        expect(details.val).toMatchObject({ status: "ready", post: imagePost(9) })
        expect(detailsMedia.rawVal).not.toBe(cachedSlot)
        expect(cachedSlot!.el.parentElement).toBeNull()
    })

    it("keeps a published cache copy when the upstream fails", async () => {
        const { serverSettings } = await import("../../src/state/settings.ts")
        serverSettings.val = { ...serverSettings.val, enabled: true, useCachedPostDetails: true }
        const cachedPost = { ...imagePost(9), score: 7 }
        api.fetchCachedPostDetails.mockResolvedValue(cachedPost)
        const upstream = deferred<PostDetails>()
        api.fetchPostDetails.mockReturnValue(upstream.promise)
        const { details, detailsLoading } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        const media = holdMediaReadiness()
        route.val = { type: "postdetails", id: 9, tags: undefined, origin: undefined }
        await flushVan()
        media.release()
        await flushVan()
        // The local copy is up; the upstream is still settling in the
        // background.
        expect(details.val).toMatchObject({ status: "ready", post: cachedPost })
        upstream.reject(new Error("gone upstream"))
        await flushVan()
        expect(details.val).toMatchObject({ status: "ready", post: cachedPost })
        expect(detailsLoading.val).toBe(false)
        media.restore()
    })

    it("keeps the original-image toggle across a cache-to-upstream upgrade", async () => {
        const { serverSettings } = await import("../../src/state/settings.ts")
        serverSettings.val = { ...serverSettings.val, enabled: true, useCachedPostDetails: true }
        api.fetchCachedPostDetails.mockResolvedValue(imagePost(9))
        const upstream = deferred<PostDetails>()
        api.fetchPostDetails.mockReturnValue(upstream.promise)
        const { detailsMedia } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        const media = holdMediaReadiness()
        route.val = { type: "postdetails", id: 9, tags: undefined, origin: undefined }
        await flushVan()
        media.release()
        await flushVan()
        // The user flips the toggle on the cached copy...
        const slot = detailsMedia.rawVal
        expect(slot).toBeDefined()
        slot!.showOriginal.val = true
        const upgraded = { ...imagePost(9), score: 11 }
        upstream.resolve(upgraded)
        await flushVan()
        // ...and the upgrade keeps it.
        expect(detailsMedia.rawVal?.post.score).toBe(11)
        expect(detailsMedia.rawVal?.showOriginal.val).toBe(true)
        media.restore()
    })
})

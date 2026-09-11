import { beforeEach, describe, expect, it, vi } from "vitest"

import type { LibraryPost } from "../../src/api/library.ts"
import type { PostDetails } from "../../src/api/post-details.ts"
import { flushVan, resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

const api = vi.hoisted(() => ({
    getPostStatuses: vi.fn(),
    observePost: vi.fn(),
    setPostStatus: vi.fn(),
    getPendingPostIds: vi.fn(),
    setFavoriteMembership: vi.fn(),
    savePostToServer: vi.fn(),
    fetchCachedPostDetails: vi.fn(),
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/library.ts", () => ({
    getPostStatuses: api.getPostStatuses,
    observePost: api.observePost,
    setPostStatus: api.setPostStatus,
    getPendingPostIds: api.getPendingPostIds,
    setFavoriteMembership: api.setFavoriteMembership,
}))
vi.mock("../../src/api/server.ts", () => ({
    savePostToServer: api.savePostToServer,
    fetchCachedPostDetails: api.fetchCachedPostDetails,
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    ServerError: class ServerError extends Error {},
}))
// The settle helpers log the user in, which fires the profile loader in
// state/auth.ts; answer it without a network.
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

function makePost(id: number): PostDetails {
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

describe("details page download of a missing favorite", () => {
    beforeEach(() => {
        vi.resetModules()
        api.getPostStatuses.mockReset()
        api.observePost.mockReset()
        api.setPostStatus.mockReset()
        api.getPendingPostIds.mockReset()
        api.setFavoriteMembership.mockReset()
        api.savePostToServer.mockReset()
        api.fetchCachedPostDetails.mockReset()
        api.checkDownloads.mockReset()
        api.getDownloadCount.mockReset()
        api.fetchProfile.mockReset()
        api.getPostStatuses.mockResolvedValue([])
        api.setPostStatus.mockResolvedValue(undefined)
        api.savePostToServer.mockResolvedValue(undefined)
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    async function load() {
        const download = await import("../../src/sync/download.ts")
        const { libraryPosts } = await import("../../src/state/library.ts")
        const { details } = await import("../../src/state/details.ts")
        const { auth } = await import("../../src/state/auth.ts")
        const { serverSettings } = await import("../../src/state/settings.ts")
        return { download, libraryPosts, details, auth, serverSettings }
    }

    // Log in and enable the server, letting the resulting context reset
    // settle first. Vanjs batches state writes: without the flush, the
    // context-reset derive in state/library.ts would clear libraryPosts in
    // the same pass the test writes into it, after the test's entry.
    async function login(ctx: Awaited<ReturnType<typeof load>>): Promise<void> {
        ctx.auth.val = { status: "authenticated", userId: 3 }
        ctx.serverSettings.val = { ...ctx.serverSettings.val, enabled: true }
        await flushVan()
    }

    // Enable the server, plant the library's view of the post, and settle the
    // details page on it — the shape the page is in once its first status
    // refresh has answered.
    async function settlePost(
        post: PostDetails,
        status: LibraryPost["status"],
        downloaded: boolean,
    ) {
        const ctx = await load()
        await login(ctx)
        ctx.libraryPosts.val = new Map([[post.id, { postId: post.id, status, downloaded }]])
        ctx.details.val = { status: "ready", post, origin: undefined }
        await flushVan()
        return ctx
    }

    it("downloads a favorited post whose media is missing", async () => {
        // The page-load refresh answers before the upload, the refresh the
        // successful download triggers answers after it.
        api.getPostStatuses
            .mockResolvedValueOnce([{ postId: 7, status: "favorited", downloaded: false }])
            .mockResolvedValue([{ postId: 7, status: "favorited", downloaded: true }])
        const post = makePost(7)
        await settlePost(post, "favorited", false)

        await vi.waitFor(() => expect(api.savePostToServer).toHaveBeenCalledTimes(1))
        expect(api.setPostStatus).toHaveBeenCalledWith(7, "favorited")
        expect(api.savePostToServer).toHaveBeenCalledWith(
            post,
            expect.anything(),
            expect.any(Number),
        )
    })

    it("does not re-download a favorite whose media is present", async () => {
        api.getPostStatuses.mockResolvedValue([
            { postId: 7, status: "favorited", downloaded: true },
        ])
        await settlePost(makePost(7), "favorited", true)
        expect(api.savePostToServer).not.toHaveBeenCalled()
    })

    it("does not download posts the library does not hold as favorites", async () => {
        const ctx = await load()
        await login(ctx)

        // No library record at all.
        ctx.details.val = { status: "ready", post: makePost(9), origin: undefined }
        await flushVan()
        expect(api.savePostToServer).not.toHaveBeenCalled()

        // A record, but not a current favorite.
        ctx.libraryPosts.val = new Map([
            [7, { postId: 7, status: "unfavorited", downloaded: false }],
        ])
        ctx.details.val = { status: "ready", post: makePost(7), origin: undefined }
        await flushVan()
        expect(api.savePostToServer).not.toHaveBeenCalled()
    })

    it("downloads a post once while triggers race", async () => {
        const { download } = await load()
        const pending = deferred<void>()
        api.savePostToServer.mockReturnValue(pending.promise)

        const first = download.downloadKnownPost(makePost(7))
        const second = download.downloadKnownPost(makePost(7))
        // The first call reaches savePostToServer only once its
        // setPostStatus promise resolves.
        await flushVan()
        expect(api.savePostToServer).toHaveBeenCalledTimes(1)
        pending.resolve()
        await first
        await second
        expect(api.savePostToServer).toHaveBeenCalledTimes(1)
    })

    it("makes one attempt per settled page when the upload fails", async () => {
        // The status refresh never answers, so a failure publishes no state
        // and the derive cannot re-fire on its own.
        api.getPostStatuses.mockRejectedValue(new Error("server down"))
        api.savePostToServer.mockRejectedValue(new Error("upload failed"))
        await settlePost(makePost(7), "favorited", false)

        await vi.waitFor(() => expect(api.savePostToServer).toHaveBeenCalledTimes(1))
        await flushVan()
        await flushVan()
        expect(api.savePostToServer).toHaveBeenCalledTimes(1)
    })

    it("attempts again when the page settles for a fresh payload", async () => {
        api.getPostStatuses.mockRejectedValue(new Error("server down"))
        api.savePostToServer.mockRejectedValue(new Error("upload failed"))
        const ctx = await load()
        await login(ctx)
        ctx.libraryPosts.val = new Map([[7, { postId: 7, status: "favorited", downloaded: false }]])
        ctx.details.val = { status: "ready", post: makePost(7), origin: undefined }
        await vi.waitFor(() => expect(api.savePostToServer).toHaveBeenCalledTimes(1))

        ctx.details.val = { status: "ready", post: makePost(7), origin: undefined }
        await vi.waitFor(() => expect(api.savePostToServer).toHaveBeenCalledTimes(2))
    })
})

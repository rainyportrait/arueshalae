import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails } from "../../src/api/post-details.ts"
import { flushVan, resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

const api = vi.hoisted(() => ({
    getPostStatuses: vi.fn(),
    observePost: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/library.ts", () => ({
    getPostStatuses: api.getPostStatuses,
    observePost: api.observePost,
}))
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

describe("state/library", () => {
    beforeEach(() => {
        vi.resetModules()
        api.getPostStatuses.mockReset()
        api.observePost.mockReset()
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("does not let an older membership response overwrite a newer one", async () => {
        const { refreshLibrary, libraryPosts } = await import("../../src/state/library.ts")
        const { auth } = await import("../../src/state/auth.ts")
        const { serverSettings } = await import("../../src/state/settings.ts")
        auth.val = { status: "authenticated", userId: 7 }
        serverSettings.val = { ...serverSettings.val, enabled: true }
        await flushVan()
        api.getPostStatuses.mockReset()

        const older = deferred<Array<Record<string, unknown>>>()
        const newer = deferred<Array<Record<string, unknown>>>()
        api.getPostStatuses.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

        const first = refreshLibrary([42])
        const second = refreshLibrary([42])
        newer.resolve([
            {
                postId: 42,
                status: "favorited",
                downloaded: false,
            },
        ])
        await second
        older.resolve([
            {
                postId: 42,
                status: "unfavorited",
                downloaded: false,
            },
        ])
        await first

        expect(libraryPosts.val.get(42)?.status).toBe("favorited")
    })

    it("publishes the initial refresh of a direct details-page load", async () => {
        // On a direct load (or refresh) of a post page, the details state
        // settles from the live document *before* this module is imported, so
        // the trigger's first evaluation fires the status refresh during
        // module import. The context-reset derive's first evaluation must not
        // be mistaken for a context change: it used to clear the request
        // sequence then, silently discarding the initial response.
        const { auth } = await import("../../src/state/auth.ts")
        const { serverSettings } = await import("../../src/state/settings.ts")
        const { details } = await import("../../src/state/details.ts")
        auth.val = { status: "authenticated", userId: 7 }
        serverSettings.val = { ...serverSettings.val, enabled: true }
        await flushVan()
        api.getPostStatuses.mockResolvedValue([
            { postId: 42, status: "favorited", downloaded: true },
        ])
        details.val = { status: "ready", post: makePost(42), origin: undefined }

        const { libraryPosts } = await import("../../src/state/library.ts")
        await flushVan()
        await flushVan()

        expect(libraryPosts.val.get(42)?.status).toBe("favorited")
    })
})

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

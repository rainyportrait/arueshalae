import { beforeEach, describe, expect, it, vi } from "vitest"

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
                membership: "favorited",
                availability: "available",
                downloaded: false,
            },
        ])
        await second
        older.resolve([
            {
                postId: 42,
                membership: "unfavorited",
                availability: "available",
                downloaded: false,
            },
        ])
        await first

        expect(libraryPosts.val.get(42)?.membership).toBe("favorited")
    })
})

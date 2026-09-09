import { beforeEach, describe, expect, it, vi } from "vitest"

import { flushVan, resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

const api = vi.hoisted(() => ({
    syncCommand: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/sync.ts", () => ({ syncCommand: api.syncCommand }))
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

describe("state/library", () => {
    beforeEach(() => {
        vi.resetModules()
        api.syncCommand.mockReset()
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("does not let an older membership response overwrite a newer one", async () => {
        const { refreshLibrary, libraryPosts } = await import("../../src/state/library.ts")
        const { auth } = await import("../../src/state/auth.ts")
        const { serverSettings } = await import("../../src/state/settings.ts")
        auth.val = { status: "authenticated", userId: 7 }
        serverSettings.val = { ...serverSettings.val, enabled: true }
        await flushVan()
        api.syncCommand.mockReset()

        const older = deferred<{ posts: Array<Record<string, unknown>> }>()
        const newer = deferred<{ posts: Array<Record<string, unknown>> }>()
        api.syncCommand.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)

        const first = refreshLibrary([42])
        const second = refreshLibrary([42])
        newer.resolve({
            posts: [
                {
                    postId: 42,
                    membership: "favorited",
                    availability: "available",
                    downloaded: false,
                    error: null,
                },
            ],
        })
        await second
        older.resolve({
            posts: [
                {
                    postId: 42,
                    membership: "unfavorited",
                    availability: "available",
                    downloaded: false,
                    error: null,
                },
            ],
        })
        await first

        expect(libraryPosts.val.get(42)?.membership).toBe("favorited")
    })
})

import van from "vanjs-core"
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest"

import type { AddFavoriteResult, RemoveFavoriteResult } from "../../src/api/favorites.ts"
import type { PostDetails } from "../../src/api/post-details.ts"
import type { FavoriteStatus } from "../../src/state/favorite-action.ts"
import { resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

// Background library refreshes and download checks stay local to the test. The
// favorite actions themselves inject their membership writers below.
const api = vi.hoisted(() => ({
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    getPostStatuses: vi.fn(),
    setFavoriteMembership: vi.fn(),
}))

vi.mock("../../src/api/server.ts", () => ({
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    ServerError: class ServerError extends Error {},
}))

vi.mock("../../src/api/library.ts", () => ({
    getPostStatuses: api.getPostStatuses,
    setFavoriteMembership: api.setFavoriteMembership,
}))

type AddFn = (id: number) => Promise<AddFavoriteResult>
type RemoveFn = (id: number) => Promise<RemoveFavoriteResult>
type SessionCheckFn = (userId: number) => Promise<boolean>
type UnfavoriteFn = (postId: number) => Promise<void>
type SaveFn = (post: PostDetails) => Promise<void>
type VoteFn = (postId: number, direction: "up") => Promise<number>

function makePost(id: number): PostDetails {
    return {
        id,
        title: "",
        media: {
            kind: "image",
            src: "https://rule34.xxx/img/2025/sample.jpg",
            originalImage: "https://wimg.rule34.xxx/img/2025/original.jpg",
            width: 0,
            height: 0,
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

describe("favorite button lifecycle", () => {
    // The modules under test read document.cookie / localStorage at import
    // time (auth, settings), so they are imported after resetDom, fresh per
    // test (the library-save queue is module state).
    async function load() {
        const [fa, dl, st] = await Promise.all([
            import("../../src/state/favorite-action.ts"),
            import("../../src/state/downloaded.ts"),
            import("../../src/state/settings.ts"),
        ])
        return { ...fa, downloaded: dl.downloaded, serverSettings: st.serverSettings }
    }

    let favorite: ReturnType<typeof van.state<FavoriteStatus>>
    let add: Mock<AddFn>
    let remove: Mock<RemoveFn>
    let sessionCheck: Mock<SessionCheckFn>
    let unfavorite: Mock<UnfavoriteFn>
    let save: Mock<SaveFn>
    let vote: Mock<VoteFn>

    beforeEach(async () => {
        vi.resetModules()
        api.checkDownloads.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        api.getPostStatuses.mockReset()
        api.getPostStatuses.mockResolvedValue([])
        api.setFavoriteMembership.mockReset()
        resetDom()
        favorite = van.state<FavoriteStatus>("idle")
        add = vi.fn<AddFn>()
        remove = vi.fn<RemoveFn>()
        sessionCheck = vi.fn<SessionCheckFn>()
        unfavorite = vi.fn<UnfavoriteFn>()
        save = vi.fn<SaveFn>()
        vote = vi.fn<VoteFn>().mockResolvedValue(17)
    })

    it("adds the favorite, saves it to the library, and settles added", async () => {
        const { addFavoriteWithStatus, membershipWrites, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockResolvedValue({ ok: true })
        const saveGate = deferred<void>()
        save.mockReturnValue(saveGate.promise)

        const done = addFavoriteWithStatus(post, favorite, () => true, add, save, vote)
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        expect(favorite.val).toBe("saving")
        expect(membershipWrites.val.has(1)).toBe(true)

        saveGate.resolve(undefined)
        await done

        expect(add).toHaveBeenCalledWith(1)
        expect(vote).toHaveBeenCalledWith(1, "up")
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 1, score: 17 }))
        expect(favorite.val).toBe("added")
        expect(downloaded.val.has(1)).toBe(false)
        expect(membershipWrites.val.size).toBe(0)
    })

    it("settles added without saving when the server is disabled", async () => {
        const { addFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: false, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockResolvedValue({ ok: true })

        await addFavoriteWithStatus(post, favorite, () => true, add, save, vote)

        expect(favorite.val).toBe("added")
        expect(save).not.toHaveBeenCalled()
        expect(downloaded.val.has(1)).toBe(false)
    })

    it("updates membership even when media is already downloaded", async () => {
        const { addFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        add.mockResolvedValue({ ok: true })

        await addFavoriteWithStatus(post, favorite, () => true, add, save, vote)

        expect(favorite.val).toBe("added")
        expect(save).toHaveBeenCalledTimes(1)
    })

    it("saves a post rule34 says is already a favorite, settling already", async () => {
        const { addFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockResolvedValue({ ok: false, reason: "already-in-favorites" })
        const saveGate = deferred<void>()
        save.mockReturnValue(saveGate.promise)

        const done = addFavoriteWithStatus(post, favorite, () => true, add, save, vote)
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

        saveGate.resolve(undefined)
        await done

        expect(favorite.val).toBe("already")
        expect(downloaded.val.has(1)).toBe(false)
    })

    it("does not save when rule34 can't be reached, keeping the button retryable", async () => {
        const { addFavoriteWithStatus, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockRejectedValue(new TypeError("fetch failed"))

        await addFavoriteWithStatus(post, favorite, () => true, add, save, vote)

        expect(favorite.val).toBe("idle")
        expect(save).not.toHaveBeenCalled()
    })

    it("does not save when the visitor is not logged in", async () => {
        const { addFavoriteWithStatus, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockResolvedValue({ ok: false, reason: "not-logged-in" })

        await addFavoriteWithStatus(post, favorite, () => true, add, save, vote)

        expect(favorite.val).toBe("idle")
        expect(save).not.toHaveBeenCalled()
    })

    it("settles library-failed when the save fails, and a retry completes it", async () => {
        const { addFavoriteWithStatus, retryFavoriteMembership, downloaded, serverSettings } =
            await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockResolvedValue({ ok: true })
        const firstSave = deferred<void>()
        save.mockReturnValueOnce(firstSave.promise)

        const done = addFavoriteWithStatus(post, favorite, () => true, add, save, vote)
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        firstSave.reject(new Error("server down"))
        await done
        expect(favorite.val).toBe("library-failed")
        expect(downloaded.val.has(1)).toBe(false)

        save.mockResolvedValue(undefined)
        await retryFavoriteMembership(post, favorite, () => true, save)

        expect(favorite.val).toBe("already")
        expect(save).toHaveBeenCalledTimes(2)
        expect(downloaded.val.has(1)).toBe(false)
    })

    it("a retry with the server disabled settles already without saving", async () => {
        const { retryFavoriteMembership, serverSettings } = await load()
        serverSettings.val = { enabled: false, url: "http://127.0.0.1:34343" }
        favorite.val = "library-failed"
        const post = makePost(1)

        await retryFavoriteMembership(post, favorite, () => true, save)

        expect(favorite.val).toBe("already")
        expect(save).not.toHaveBeenCalled()
    })

    it("does not write stale state after navigation", async () => {
        const { addFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        const addGate = deferred<AddFavoriteResult>()
        add.mockReturnValue(addGate.promise)
        let current = true
        const isCurrent = () => current

        const done = addFavoriteWithStatus(post, favorite, isCurrent, add, save, vote)
        await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1))
        // The user stepped to the next post: the per-post state reset...
        current = false
        favorite.val = "idle"
        addGate.resolve({ ok: true })
        await done

        expect(favorite.val).toBe("idle")
        expect(save).not.toHaveBeenCalled()
        expect(downloaded.val.has(1)).toBe(false)
    })

    it("joins an in-flight save instead of starting a duplicate", async () => {
        const { addFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        add.mockResolvedValue({ ok: true })
        const saveGate = deferred<void>()
        save.mockReturnValue(saveGate.promise)

        const first = addFavoriteWithStatus(post, favorite, () => true, add, save, vote)
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

        // A remount of the same post triggers the whole flow again...
        const favorite2 = van.state<FavoriteStatus>("idle")
        const second = addFavoriteWithStatus(post, favorite2, () => true, add, save, vote)
        await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(2))

        saveGate.resolve(undefined)
        await Promise.all([first, second])

        expect(save).toHaveBeenCalledTimes(1)
        expect(favorite.val).toBe("added")
        expect(favorite2.val).toBe("added")
        expect(downloaded.val.has(1)).toBe(false)
    })

    it("marks the post unfavorited and retains downloaded media", async () => {
        const { removeFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        remove.mockResolvedValue({ ok: true })

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(remove).toHaveBeenCalledWith(1)
        expect(unfavorite).toHaveBeenCalledTimes(1)
        expect(favorite.val).toBe("idle")
        expect(downloaded.val.has(1)).toBe(true)
        expect(sessionCheck).not.toHaveBeenCalled()
    })

    it("settles idle without writing locally when the server is disabled", async () => {
        const { removeFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: false, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        remove.mockResolvedValue({ ok: true })

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(favorite.val).toBe("idle")
        expect(unfavorite).not.toHaveBeenCalled()
    })

    it("updates membership even before media is downloaded", async () => {
        const { removeFavoriteWithStatus, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        remove.mockResolvedValue({ ok: true })

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(favorite.val).toBe("idle")
        expect(unfavorite).toHaveBeenCalledTimes(1)
    })

    it("updates drifted membership on a 403 when the session is alive", async () => {
        const { removeFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        remove.mockResolvedValue({ ok: false, reason: "forbidden" })
        sessionCheck.mockResolvedValue(true)

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(unfavorite).toHaveBeenCalledTimes(1)
        expect(favorite.val).toBe("idle")
        expect(downloaded.val.has(1)).toBe(true)
    })

    it("settles stale-session without writing when the session is dead", async () => {
        const { removeFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        remove.mockResolvedValue({ ok: false, reason: "forbidden" })
        sessionCheck.mockResolvedValue(false)

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(favorite.val).toBe("stale-session")
        expect(unfavorite).not.toHaveBeenCalled()
        expect(downloaded.val.has(1)).toBe(true)
    })

    it("restores the pre-click face when the session check fails", async () => {
        const { removeFavoriteWithStatus, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        favorite.val = "added"
        remove.mockResolvedValue({ ok: false, reason: "forbidden" })
        sessionCheck.mockRejectedValue(new TypeError("fetch failed"))

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(favorite.val).toBe("added")
        expect(unfavorite).not.toHaveBeenCalled()
    })

    it("restores the pre-click face when rule34 can't be reached", async () => {
        const { removeFavoriteWithStatus, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post = makePost(1)
        favorite.val = "added"
        remove.mockRejectedValue(new TypeError("fetch failed"))

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(favorite.val).toBe("added")
        expect(unfavorite).not.toHaveBeenCalled()
        expect(sessionCheck).not.toHaveBeenCalled()
    })

    it("settles removal-failed when the membership write fails, then retries it", async () => {
        const { removeFavoriteWithStatus, retryUnfavoriteMembership, downloaded, serverSettings } =
            await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        remove.mockResolvedValue({ ok: true })
        unfavorite.mockRejectedValueOnce(new Error("server down"))

        await removeFavoriteWithStatus(post, favorite, () => true, remove, sessionCheck, unfavorite)

        expect(favorite.val).toBe("removal-failed")
        expect(downloaded.val.has(1)).toBe(true)

        unfavorite.mockResolvedValue(undefined)
        await retryUnfavoriteMembership(post, favorite, () => true, unfavorite)

        expect(favorite.val).toBe("idle")
        expect(unfavorite).toHaveBeenCalledTimes(2)
        expect(downloaded.val.has(1)).toBe(true)
    })

    it("a retry with the server disabled settles idle without writing", async () => {
        const { retryUnfavoriteMembership, serverSettings } = await load()
        serverSettings.val = { enabled: false, url: "http://127.0.0.1:34343" }
        favorite.val = "removal-failed"
        const post = makePost(1)

        await retryUnfavoriteMembership(post, favorite, () => true, unfavorite)

        expect(favorite.val).toBe("idle")
        expect(unfavorite).not.toHaveBeenCalled()
    })

    it("does not write stale state after a removal navigation", async () => {
        const { removeFavoriteWithStatus, downloaded, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        downloaded.val = new Set([1])
        const post = makePost(1)
        remove.mockResolvedValue({ ok: true })
        const writeGate = deferred<void>()
        unfavorite.mockReturnValue(writeGate.promise)
        let current = true
        const isCurrent = () => current

        const done = removeFavoriteWithStatus(
            post,
            favorite,
            isCurrent,
            remove,
            sessionCheck,
            unfavorite,
        )
        await vi.waitFor(() => expect(unfavorite).toHaveBeenCalledTimes(1))

        // The user stepped to the next post: the per-post state reset.
        current = false
        favorite.val = "idle"
        writeGate.resolve(undefined)
        await done

        expect(favorite.val).toBe("idle")
        expect(downloaded.val.has(1)).toBe(true)
    })

    it("serializes saves across posts", async () => {
        const { addFavoriteWithStatus, serverSettings } = await load()
        serverSettings.val = { enabled: true, url: "http://127.0.0.1:34343" }
        const post1 = makePost(1)
        const post2 = makePost(2)
        add.mockResolvedValue({ ok: true })
        const saveGate = deferred<void>()
        save.mockImplementation((p: PostDetails) =>
            p.id === 1 ? saveGate.promise : Promise.resolve(),
        )
        const favorite2 = van.state<FavoriteStatus>("idle")

        const first = addFavoriteWithStatus(post1, favorite, () => true, add, save, vote)
        const second = addFavoriteWithStatus(post2, favorite2, () => true, add, save, vote)
        await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
        // Post 2's save waits for post 1's.
        expect(favorite2.val).toBe("saving")

        saveGate.resolve(undefined)
        await Promise.all([first, second])

        expect(save).toHaveBeenCalledTimes(2)
        expect(favorite.val).toBe("added")
        expect(favorite2.val).toBe("added")
    })
})

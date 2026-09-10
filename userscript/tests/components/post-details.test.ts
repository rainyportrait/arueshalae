import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails as PostDetailsData } from "../../src/api/post-details.ts"
import type { Post } from "../../src/api/post-list.ts"
import { flushVan, resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

const api = vi.hoisted(() => ({
    fetchFavorites: vi.fn(),
    fetchPostDetails: vi.fn(),
    fetchPostList: vi.fn(),
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/favorites.ts", () => ({ fetchFavorites: api.fetchFavorites }))
vi.mock("../../src/api/post-details.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchPostDetails: api.fetchPostDetails,
}))
vi.mock("../../src/api/post-list.ts", () => ({ fetchPostList: api.fetchPostList }))
vi.mock("../../src/api/server.ts", () => ({
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    ServerError: class ServerError extends Error {},
}))
// The button tests log the user in, which fires the profile loader in
// state/auth.ts; answer it without a network.
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

function post(id: number): Post {
    return {
        id,
        link: `/index.php?page=post&s=view&id=${id}&tags=test`,
        thumbnail: `//cdn.example/${id}.jpg`,
        tags: [],
    }
}

function details(id: number): PostDetailsData {
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

describe("PostDetails gallery", () => {
    beforeEach(() => {
        vi.resetModules()
        api.fetchFavorites.mockReset()
        api.fetchPostDetails.mockReset()
        api.fetchPostList.mockReset()
        api.checkDownloads.mockReset()
        api.getDownloadCount.mockReset()
        // The details loader and the gallery's neighbor prefetch fire for the
        // postdetails routes the tests set: answer with the test's own fixture.
        api.fetchPostDetails.mockImplementation((id: number) => Promise.resolve(details(id)))
        // The server check (state/downloaded.ts) fires whenever a post settles
        // while the server is enabled: answer with an empty set by default.
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("gives each filmstrip link the pid of its containing page", async () => {
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        const { details: detailsState } = await import("../../src/state/details.ts")
        const { gallery } = await import("../../src/state/gallery.ts")
        detailsState.val = { status: "ready", post: details(3), origin }
        gallery.val = {
            status: "ready",
            origin,
            pages: [
                { pid: 0, posts: [post(1), post(2)] },
                { pid: 42, posts: [post(3), post(4)] },
            ],
            lastPagePID: 42,
        }
        const { PostDetails } = await import("../../src/PostDetails.ts")

        document.body.append(PostDetails())
        await flushVan()

        const links = [...document.querySelectorAll<HTMLAnchorElement>('a[title^="Post #"]')]
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
            "/index.php?page=post&s=view&id=1&tags=test&pid=0",
            "/index.php?page=post&s=view&id=2&tags=test&pid=0",
            "/index.php?page=post&s=view&id=3&tags=test&pid=42",
            "/index.php?page=post&s=view&id=4&tags=test&pid=42",
        ])
    })

    it("shows a post the feed shift put into two pages only once", async () => {
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        const { details: detailsState } = await import("../../src/state/details.ts")
        const { gallery } = await import("../../src/state/gallery.ts")
        detailsState.val = { status: "ready", post: details(3), origin }
        gallery.val = {
            status: "ready",
            origin,
            pages: [
                { pid: 0, posts: [post(1), post(2), post(3)] },
                // The feed shifted before page 42 fetched: its window starts
                // inside page 0's id range, so posts 2 and 3 repeat.
                { pid: 42, posts: [post(2), post(3), post(4)] },
            ],
            lastPagePID: 42,
        }
        const { PostDetails } = await import("../../src/PostDetails.ts")

        document.body.append(PostDetails())
        await flushVan()

        const links = [...document.querySelectorAll<HTMLAnchorElement>('a[title^="Post #"]')]
        // Each post once, with the pid of the first page that carries it.
        expect(links.map((link) => link.getAttribute("href"))).toEqual([
            "/index.php?page=post&s=view&id=1&tags=test&pid=0",
            "/index.php?page=post&s=view&id=2&tags=test&pid=0",
            "/index.php?page=post&s=view&id=3&tags=test&pid=0",
            "/index.php?page=post&s=view&id=4&tags=test&pid=42",
        ])
        // The counter counts deduped posts (the active one is post 3).
        const counter = [...document.querySelectorAll("span")].find((span) =>
            /^\d+ \/ \d+$/.test(span.textContent ?? ""),
        )
        expect(counter?.textContent).toBe("3 / 4")
    })

    it("shows the counter and enables the arrows once the search finds the active post", async () => {
        // The active post is not on the origin page: the gallery's post
        // search loads the following page, which contains it. The route stays
        // put while both pages settle, so the counter and arrows must update
        // through their gallery-state dependency, not a route change.
        api.fetchPostList.mockImplementation((_tags: string | undefined, pid: number) =>
            Promise.resolve({
                posts: pid === 0 ? [post(1), post(2)] : [post(3), post(4)],
                lastPagePID: 42,
                tags: [],
            }),
        )
        const { details: detailsState } = await import("../../src/state/details.ts")
        const { route } = await import("../../src/router.ts")
        const { PostDetails } = await import("../../src/PostDetails.ts")
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        detailsState.val = { status: "ready", post: details(4), origin }
        document.body.append(PostDetails())
        route.val = { type: "postdetails", id: 4, tags: "test", origin }
        await flushVan()

        const counter = [...document.querySelectorAll("span")].find((span) =>
            /^\d+ \/ \d+$/.test(span.textContent ?? ""),
        )
        expect(counter?.textContent).toBe("4 / 4")
        // The post sits at the loaded end: back is possible, forward isn't
        // (the collection ends with page 42).
        const [prev, next] = [
            ...document.querySelectorAll<HTMLButtonElement>("button[title*='post']"),
        ]
        expect(prev?.className).toContain("cursor-pointer")
        expect(prev?.className).not.toContain("opacity-30")
        expect(next?.className).toContain("opacity-30")
    })
})

describe("PostDetails favorite button, server state", () => {
    beforeEach(() => {
        vi.resetModules()
        api.fetchFavorites.mockReset()
        api.fetchPostDetails.mockReset()
        api.fetchPostList.mockReset()
        api.checkDownloads.mockReset()
        api.getDownloadCount.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    // Mount the details page directly on a ready post (no gallery origin, so
    // the filmstrip stays out) and log the user in, so the button shows.
    async function mountDetails(id: number) {
        const { details: detailsState } = await import("../../src/state/details.ts")
        const { auth } = await import("../../src/state/auth.ts")
        const { serverSettings } = await import("../../src/state/settings.ts")
        const { PostDetails } = await import("../../src/PostDetails.ts")
        auth.val = { status: "authenticated", userId: 5 }
        serverSettings.val = { ...serverSettings.val, enabled: true }
        detailsState.val = { status: "ready", post: details(id), origin: undefined }
        document.body.append(PostDetails())
        await flushVan()
        return { serverSettings }
    }

    function favoriteButton(): HTMLButtonElement | null {
        return (
            [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
                (button.textContent ?? "").includes("favorites"),
            ) ?? null
        )
    }

    async function setLibraryPost(postId: number, downloaded: boolean): Promise<void> {
        const { libraryPosts } = await import("../../src/state/library.ts")
        libraryPosts.val = new Map([
            [
                postId,
                {
                    postId,
                    membership: "favorited",
                    availability: "available",
                    downloaded,
                },
            ],
        ])
        await flushVan()
    }

    it("starts available when the post is not in the user's library", async () => {
        await mountDetails(3)

        const button = favoriteButton()
        expect(button?.textContent).toBe("Add to favorites")
        expect(button?.disabled).toBe(false)
    })

    it("starts in the remove face when the server holds the post", async () => {
        // The "already" face is the toggle's "Remove from favorites" face,
        // so the button is active, not a disabled end state.
        await mountDetails(3)
        await setLibraryPost(3, true)

        const button = favoriteButton()
        expect(button?.textContent).toBe("Remove from favorites")
        expect(button?.disabled).toBe(false)
    })

    it("membership independently updates the favorite button", async () => {
        await mountDetails(3)
        expect(favoriteButton()?.textContent).toBe("Add to favorites")
        await setLibraryPost(3, false)
        expect(favoriteButton()?.textContent).toBe("Remove from favorites")
    })

    it("drops back to available when the server is disabled", async () => {
        const { serverSettings } = await mountDetails(3)
        await setLibraryPost(3, true)
        expect(favoriteButton()?.textContent).toBe("Remove from favorites")

        serverSettings.val = { ...serverSettings.val, enabled: false }
        await flushVan()

        const button = favoriteButton()
        expect(button?.textContent).toBe("Add to favorites")
        expect(button?.disabled).toBe(false)
    })
})

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostMedia } from "../src/api/post-details.ts"
import type { Post } from "../src/api/post-list.ts"
import { resetDom } from "./dom.ts"

const api = vi.hoisted(() => ({
    checkDownloads: vi.fn(),
    fetchFavorites: vi.fn(),
    fetchPostDetails: vi.fn(),
    fetchPostList: vi.fn(),
    getDownloadCount: vi.fn(),
}))

vi.mock("../src/api/server.ts", () => ({
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    ServerError: class ServerError extends Error {},
}))
vi.mock("../src/api/favorites.ts", () => ({ fetchFavorites: api.fetchFavorites }))
vi.mock("../src/api/post-details.ts", () => ({ fetchPostDetails: api.fetchPostDetails }))
vi.mock("../src/api/post-list.ts", () => ({ fetchPostList: api.fetchPostList }))

const post: Post = {
    id: 42,
    link: "/index.php?page=post&s=view&id=42",
    thumbnail: "//rule34.example/thumb.jpg",
    tags: [],
}

const image: Extract<PostMedia, { kind: "image" }> = {
    kind: "image",
    src: "//rule34.example/sample.jpg",
    originalImage: "//rule34.example/original.jpg",
    width: 100,
    height: 100,
}

const video: Extract<PostMedia, { kind: "video" }> = {
    kind: "video",
    src: "//rule34.example/video.mp4",
    poster: "//rule34.example/poster.jpg",
    width: 100,
    height: 100,
}

describe("media source selection", () => {
    beforeEach(() => {
        vi.resetModules()
        api.checkDownloads.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    async function load() {
        const urls = await import("../src/media-source.ts")
        const { downloaded } = await import("../src/state/downloaded.ts")
        const { serverSettings } = await import("../src/state/settings.ts")
        serverSettings.val = {
            enabled: true,
            url: "http://127.0.0.1:34343/",
            preferDownloaded: true,
        }
        downloaded.val = new Set([42])
        return { ...urls, downloaded, serverSettings }
    }

    it("uses each server endpoint for downloaded media", async () => {
        const urls = await load()

        expect(urls.thumbnailUrl(post)).toBe("http://127.0.0.1:34343/api/posts/42/media?type=mini")
        expect(urls.imageUrl(42, image, false)).toBe("http://127.0.0.1:34343/api/posts/42/media")
        expect(urls.videoPosterUrl(42, video)).toBe("http://127.0.0.1:34343/api/posts/42/media")
        expect(urls.videoUrl(42, video)).toBe(
            "http://127.0.0.1:34343/api/posts/42/media?type=video",
        )
    })

    it("keeps Rule34 image quality independent when local media is not preferred", async () => {
        const urls = await load()
        urls.serverSettings.val = { ...urls.serverSettings.val, preferDownloaded: false }

        expect(urls.thumbnailUrl(post)).toBe(post.thumbnail)
        expect(urls.imageUrl(42, image, false)).toBe(image.src)
        expect(urls.imageUrl(42, image, true)).toBe(image.originalImage)
        expect(urls.videoPosterUrl(42, video)).toBe(video.poster)
        expect(urls.videoUrl(42, video)).toBe(video.src)
    })

    it("treats the missing legacy preference as enabled", async () => {
        const urls = await load()
        urls.serverSettings.val = {
            enabled: true,
            url: "http://127.0.0.1:34343",
        }

        expect(urls.thumbnailUrl(post)).toContain("/api/posts/42/media?type=mini")
    })
})

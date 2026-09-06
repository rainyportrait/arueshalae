import { afterEach, describe, expect, it, vi } from "vitest"

import { extractFavorites } from "../../src/api/favorites.ts"
import { isAnimated } from "../../src/api/tags.ts"
import { fixture } from "../helpers/fixture.ts"

describe("favorites extraction", () => {
    it("reads posts from the favorites markup", () => {
        const document = fixture("favorites.html")

        expect(extractFavorites(document, 0).posts).toEqual([
            {
                id: 101,
                link: "index.php?page=post&s=view&id=101",
                thumbnail: "//cdn.example/101.jpg?101",
                tags: ["boy", "1girls", "3d", "video"],
            },
            {
                id: 102,
                link: "index.php?page=post&s=view&id=102",
                thumbnail: "//cdn.example/102.jpg?102",
                tags: ["ass", "1girls", "3d", "video", "wide_hip"],
            },
        ])
    })

    it("restores a last tag truncated to `vide` so the animated check sees it", () => {
        const document = fixture("favorites.html")
        const posts = extractFavorites(document, 0).posts

        expect(isAnimated(posts[0].tags)).toBe(true)
        // An intact `video` elsewhere in the list passes through unchanged.
        expect(posts[1].tags).toContain("video")
    })
})

describe("removeFavorite", () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    // removeFavorite goes through the rate-limit queue in network.ts; a
    // fresh import starts it with an empty queue, so a single request hits
    // the wire with no artificial delay.
    async function removeFavorite(id: number): Promise<unknown> {
        const { removeFavorite } = await import("../../src/api/favorites.ts")
        return removeFavorite(id)
    }

    it("reports ok on a 200 answer", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("", { status: 200 })),
        )

        await expect(removeFavorite(123)).resolves.toEqual({ ok: true })
    })

    it("reports forbidden on a 403 answer", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("", { status: 403 })),
        )

        await expect(removeFavorite(123)).resolves.toEqual({ ok: false, reason: "forbidden" })
    })

    it("throws on any other status", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => new Response("", { status: 500 })),
        )

        await expect(removeFavorite(123)).rejects.toThrow("status 500")
    })
})

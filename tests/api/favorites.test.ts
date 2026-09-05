import { describe, expect, it } from "vitest"

import { extractFavorites } from "../../userscript/api/favorites.ts"
import { isAnimated } from "../../userscript/api/tags.ts"
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

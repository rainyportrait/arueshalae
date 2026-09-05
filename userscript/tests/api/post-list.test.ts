import { describe, expect, it } from "vitest"

import { extractPosts } from "../../src/api/post-list.ts"
import { extractTags, isAnimated } from "../../src/api/tags.ts"
import { fixture } from "../helpers/fixture.ts"

describe("post-list extraction", () => {
    it("reads posts from the site's nested thumb structure", () => {
        const document = fixture("post-list.html")

        expect(extractPosts(document.querySelector(".image-list")!)).toEqual([
            {
                id: 101,
                link: "/index.php?page=post&s=view&id=101&tags=odd_tag",
                thumbnail: "//cdn.example/101.jpg",
                tags: ["odd_tag", "animated_gif"],
            },
        ])
    })

    it("extracts typed tags and recognizes animated format tags", () => {
        const tags = extractTags(fixture("post-list.html"))

        expect(tags).toEqual([
            {
                name: "Some Character",
                slug: "some_character",
                type: "character",
                count: 9876,
            },
        ])
        expect(isAnimated(["animated_gif"])).toBe(true)
    })
})

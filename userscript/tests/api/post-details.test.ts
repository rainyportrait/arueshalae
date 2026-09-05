import { describe, expect, it } from "vitest"

import { extractPostDetails } from "../../src/api/post-details.ts"
import { fixture } from "../helpers/fixture.ts"

describe("extractPostDetails", () => {
    it("preserves negative scores and extracts the surrounding server structure", () => {
        const post = extractPostDetails(fixture("post-details-negative.html"), 123)

        expect(post).toMatchObject({
            id: 123,
            title: "A deliberately odd fixture",
            posted: "2026-09-04 12:34:56",
            poster: "tester",
            source: "source page",
            rating: "Explicit",
            score: -12,
            media: {
                kind: "image",
                src: "//cdn.example/sample.jpg",
                originalImage: "//cdn.example/original.jpg",
                width: 700,
                height: 874,
            },
        })
        expect(post.tags).toEqual([
            { name: "some artist", slug: "some_artist", type: "artist", count: 1234 },
        ])
    })
})

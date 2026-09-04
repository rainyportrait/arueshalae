import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails as PostDetailsData } from "../../userscript/api/post-details.ts"
import type { Post } from "../../userscript/api/post-list.ts"
import { flushVan, resetDom } from "../dom.ts"

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
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("gives each filmstrip link the pid of its containing page", async () => {
        const origin = { kind: "list" as const, tags: "test", pid: 0 }
        const { details: detailsState } = await import("../../userscript/state/details.ts")
        const { gallery } = await import("../../userscript/state/gallery.ts")
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
        const { PostDetails } = await import("../../userscript/PostDetails.ts")

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
})

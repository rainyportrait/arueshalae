import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Post } from "../../userscript/api/post-list.ts"
import type { Tag } from "../../userscript/api/tags.ts"
import { flushVan, resetDom } from "../dom.ts"

// The list loader is triggered by postlist routes; the tests sit on the
// settings route and set the list state directly, so the fetcher is a stub.
vi.mock("../../userscript/api/post-list.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchPostList: vi.fn(),
}))

function tag(name: string, type: Tag["type"]): Tag {
    return { name, slug: name, type, count: 3 }
}

function post(id: number, tags: string[]): Post {
    return {
        id,
        link: `/index.php?page=post&s=view&id=${id}&tags=test`,
        thumbnail: `//cdn.example/${id}.jpg`,
        tags,
    }
}

async function mountPostList(tags: Tag[], posts: Post[]) {
    const { list } = await import("../../userscript/state/list.ts")
    list.val = { status: "ready", posts, lastPagePID: 0, tags, pid: 0, query: "test" }
    const { PostList } = await import("../../userscript/PostList.ts")
    document.body.append(PostList())
    await flushVan()
    return { list, body: document.body }
}

function tagToggle(body: HTMLElement): HTMLButtonElement {
    const button = body.querySelector<HTMLButtonElement>("button[aria-expanded]")
    if (button === null) throw new Error("tag disclosure button not found")
    return button
}

// The desktop sidebar is in the DOM too (linkedom applies no CSS, so its
// `min-[808px]:block` hiding is inert); assert on the mobile block only.
function mobileBlock(body: HTMLElement): HTMLElement {
    const el = body.querySelector<HTMLElement>('div[class*="min-[808px]:hidden"]')
    if (el === null) throw new Error("mobile sidebar block not found")
    return el
}

// Whole tokens on purpose: "hover:bg-zinc-800/60" carries the active class
// as a substring, so a raw contains check would match either state.
function hasClass(el: HTMLElement, name: string): boolean {
    return el.className.split(/\s+/).includes(name)
}

describe("PostList mobile tag disclosure", () => {
    beforeEach(() => {
        vi.resetModules()
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("shows a collapsed disclosure carrying the tag count", async () => {
        const { body } = await mountPostList(
            [tag("artist_name", "artist"), tag("char_a", "character"), tag("char_b", "character")],
            [],
        )
        const toggle = tagToggle(body)
        expect(toggle.getAttribute("aria-expanded")).toBe("false")
        expect(toggle.textContent).toContain("Tags")
        expect(toggle.textContent).toContain("3")
        // Collapsed: the tag rows are not in the mobile block.
        expect(mobileBlock(body).textContent).not.toContain("artist_name")
    })

    it("expands the tag list on click and collapses again", async () => {
        const { body } = await mountPostList([tag("artist_name", "artist")], [])
        const toggle = tagToggle(body)
        toggle.click()
        await flushVan()
        expect(toggle.getAttribute("aria-expanded")).toBe("true")
        // The open state is carried by the button's active background.
        expect(hasClass(toggle, "bg-zinc-800/60")).toBe(true)
        // The group heading and the tag row are both up.
        expect(mobileBlock(body).textContent).toContain("Artist")
        expect(mobileBlock(body).textContent).toContain("artist_name")

        toggle.click()
        await flushVan()
        expect(toggle.getAttribute("aria-expanded")).toBe("false")
        expect(hasClass(toggle, "bg-zinc-800/60")).toBe(false)
        expect(mobileBlock(body).textContent).not.toContain("artist_name")
    })

    it("keeps the disclosure open when a new page settles", async () => {
        const { list, body } = await mountPostList([tag("artist_name", "artist")], [])
        const toggle = tagToggle(body)
        toggle.click()
        await flushVan()

        list.val = {
            status: "ready",
            posts: [],
            lastPagePID: 0,
            tags: [tag("other_tag", "general")],
            pid: 0,
            query: "other",
        }
        await flushVan()

        expect(tagToggle(body).getAttribute("aria-expanded")).toBe("true")
        const mobile = mobileBlock(body)
        expect(mobile.textContent).toContain("other_tag")
        expect(mobile.textContent).not.toContain("artist_name")
    })

    it("shows the hidden-posts toggle on mobile, not only in the sidebar", async () => {
        const { tagBlacklist } = await import("../../userscript/state/settings.ts")
        tagBlacklist.val = ["nsfw"]
        const { body } = await mountPostList([tag("nsfw", "general")], [post(1, ["nsfw"])])

        // The empty state points at the toggle, and the toggle is reachable
        // in the mobile block (the sidebar copy is inert there too).
        expect(body.textContent).toContain("Use the hidden-posts toggle to reveal them.")
        const hidden = [...mobileBlock(body).querySelectorAll("button")].find((button) =>
            (button.textContent ?? "").includes("hidden"),
        )
        expect(hidden?.textContent).toBe("🙈 1 hidden")

        hidden?.click()
        await flushVan()
        expect(hidden?.textContent).toBe("👁 1 hidden — showing")
    })

    it("drops out entirely with no tags and nothing hidden", async () => {
        const { body } = await mountPostList([], [post(1, [])])
        expect(body.querySelector("button[aria-expanded]")).toBeNull()
        expect(body.querySelector('div[class*="min-[808px]:hidden"]')).toBeNull()
    })
})

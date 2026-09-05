import { beforeEach, describe, expect, it, vi } from "vitest"

import { resetDom } from "../dom.ts"

// The test window has no KeyboardEvent constructor, so a plain keydown Event
// carries the properties the handler reads.
function pressKey(
    target: EventTarget,
    key: string,
    init: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {},
): Event {
    const event = new Event("keydown", { bubbles: true, cancelable: true })
    Object.assign(event, { key, ...init })
    target.dispatchEvent(event)
    return event
}

const INITIAL_ROUTE = { type: "postlist" as const, tags: undefined, pid: 0 }

describe("Pagination arrow-key paging", () => {
    beforeEach(() => {
        vi.resetModules()
        resetDom()
    })

    async function mountPagination(currentPage: number, totalPages: number) {
        const { Pagination } = await import("../../src/Pagination.ts")
        const el = Pagination({
            currentPage,
            totalPages,
            routeForPage: (page) => ({
                type: "postlist" as const,
                tags: "test",
                pid: (page - 1) * 42,
            }),
        })
        document.body.append(el)
        const { route } = await import("../../src/router.ts")
        return { el, route }
    }

    it("advances the page with ArrowRight", async () => {
        const { route } = await mountPagination(2, 5)
        const event = pressKey(document, "ArrowRight")

        expect(route.val).toEqual({ type: "postlist", tags: "test", pid: 84 })
        expect(window.location.search).toBe("?page=post&s=list&tags=test&pid=84")
        expect(event.defaultPrevented).toBe(true)
    })

    it("goes back a page with ArrowLeft", async () => {
        const { route } = await mountPagination(2, 5)
        const event = pressKey(document, "ArrowLeft")

        expect(route.val).toEqual({ type: "postlist", tags: "test", pid: 0 })
        expect(window.location.search).toBe("?page=post&s=list&tags=test")
        expect(event.defaultPrevented).toBe(true)
    })

    it("does not page before the first page", async () => {
        const { route } = await mountPagination(1, 5)
        const event = pressKey(document, "ArrowLeft")

        expect(route.val).toEqual(INITIAL_ROUTE)
        expect(window.location.search).toBe("?page=post&s=list")
        expect(event.defaultPrevented).toBe(false)
    })

    it("does not page past the last page", async () => {
        const { route } = await mountPagination(5, 5)
        const event = pressKey(document, "ArrowRight")

        expect(route.val).toEqual(INITIAL_ROUTE)
        expect(event.defaultPrevented).toBe(false)
    })

    it("ignores the arrows while typing in a form field", async () => {
        const { route } = await mountPagination(2, 5)
        const input = document.createElement("input")
        document.body.append(input)

        pressKey(input, "ArrowRight")

        expect(route.val).toEqual(INITIAL_ROUTE)
    })

    it("ignores modified arrows (the browser's history navigation)", async () => {
        const { route } = await mountPagination(2, 5)

        for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
            pressKey(document, "ArrowRight", init)
        }

        expect(route.val).toEqual(INITIAL_ROUTE)
    })

    it("ignores the arrows off a list page", async () => {
        const { route } = await mountPagination(2, 5)
        route.val = { type: "postdetails", id: 1, tags: "test", origin: undefined }

        pressKey(document, "ArrowRight")

        expect(route.val).toEqual({ type: "postdetails", id: 1, tags: "test", origin: undefined })
    })

    it("removes its listener once the nav leaves the document", async () => {
        const { el, route } = await mountPagination(2, 5)
        const remove = vi.spyOn(document, "removeEventListener")
        el.remove()

        pressKey(document, "ArrowRight")

        expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function))
        expect(route.val).toEqual(INITIAL_ROUTE)
    })
})

import { beforeEach, describe, expect, it } from "vitest"

// The history methods wrapped by state/scroll.ts live on the first module
// evaluation in this file, so the modules are imported once (no resetModules)
// and only the DOM/history is reset between tests; the popstate below then
// re-syncs the route with the reset URL, as a real navigation would.
import { navigate } from "../../userscript/router.ts"
import { applyRestore, rememberScroll, scrollRestore } from "../../userscript/state/scroll.ts"
import { flushVan, pushForeignEntry, resetDom, setEntryState, setTestScrollY } from "../dom.ts"

const LIST_URL = "https://rule34.xxx/index.php?page=post&s=list"

function post(id: number) {
    return { type: "postdetails", id, tags: undefined, origin: undefined } as const
}

beforeEach(() => {
    resetDom(LIST_URL)
    dispatchEvent(new Event("popstate"))
})

describe("scroll memory", () => {
    it("restores the list offset when back returns from a post", async () => {
        setTestScrollY(1234)
        rememberScroll()
        navigate(post(17069095))
        expect(location.pathname + location.search).toBe("/index.php?page=post&s=view&id=17069095")

        history.back()
        expect(scrollRestore.val).toBe(1234)
        await flushVan()
    })

    it("snapshots the outgoing offset on the push itself, without an explicit remember", async () => {
        setTestScrollY(42)
        navigate(post(17069095))

        history.back()
        expect(scrollRestore.val).toBe(42)
    })

    it("restores each entry's own offset across back and forward", async () => {
        setTestScrollY(1234)
        rememberScroll()
        navigate(post(1))
        setTestScrollY(50)
        rememberScroll()

        history.back()
        expect(scrollRestore.val).toBe(1234)
        history.forward()
        expect(scrollRestore.val).toBe(50)
    })

    it("keeps a per-page offset for same-type page turns", async () => {
        setTestScrollY(100)
        rememberScroll()
        navigate({ type: "postlist", tags: undefined, pid: 42 })
        setTestScrollY(999)
        rememberScroll()

        history.back()
        expect(scrollRestore.val).toBe(100)
    })

    it("clears a pending restore when a push navigation supersedes it", async () => {
        setTestScrollY(77)
        rememberScroll()
        navigate(post(2))
        history.back()
        expect(scrollRestore.val).toBe(77)

        navigate({ type: "postlist", tags: "fresh", pid: 0 })
        expect(scrollRestore.val).toBeNull()
    })

    it("clears a pending restore when the current entry is replaced", async () => {
        setTestScrollY(200)
        rememberScroll()
        navigate(post(7))
        history.back()
        expect(scrollRestore.val).toBe(200)

        setTestScrollY(350)
        navigate(post(8), { replace: true })
        expect(scrollRestore.val).toBeNull()
    })

    it("stamps an untracked entry on arrival, merging foreign state, and restores nothing", async () => {
        // Push a page, then make the list entry look like one an unrelated
        // script pushed: its state carries no scroll token.
        navigate(post(3))
        history.back()
        setEntryState(0, { foreign: 1 })

        navigate(post(4))
        history.back()

        expect(scrollRestore.val).toBeNull()
        expect(history.state).toEqual({ foreign: 1, "arue-scroll": expect.any(Number) })
    })

    it("leaves an untracked entry's state alone when it is already stamped", () => {
        // A token-less entry arriving for the second time keeps its token.
        navigate(post(5))
        const token = (history.state as Record<string, unknown>)["arue-scroll"]
        expect(typeof token).toBe("number")

        history.back()
        history.forward()
        expect((history.state as Record<string, unknown>)["arue-scroll"]).toBe(token)
    })

    it("applies the pending restore to the window once consumed", async () => {
        setTestScrollY(600)
        rememberScroll()
        navigate(post(9))
        history.back()
        expect(scrollRestore.val).toBe(600)

        applyRestore()
        await flushVan()

        expect(scrollRestore.val).toBeNull()
        expect(window.scrollY).toBe(600)
    })

    it("voids a restore when the entry moves on before it applies", async () => {
        setTestScrollY(600)
        rememberScroll()
        navigate(post(9))
        history.back()

        setTestScrollY(0)
        applyRestore() // schedules the microtask for the list entry
        navigate({ type: "postlist", tags: "moved-on", pid: 0 })

        await flushVan()
        expect(window.scrollY).toBe(0)
    })

    it("stamps an entry pushed behind its back on arrival, restoring nothing", () => {
        // The entry appeared without going through the wrapped methods (an
        // unrelated script's pushState fires no event), so it has no token
        // and no remembered offset: arriving there by forward stamps it.
        pushForeignEntry("/index.php?page=post&s=view&id=3")
        history.back()
        history.forward()

        expect(scrollRestore.val).toBeNull()
        expect(history.state).toEqual({ "arue-scroll": expect.any(Number) })
    })
})

import { beforeEach, describe, expect, it } from "vitest"

import { parseRoute, postHref, routeToUrl } from "../src/router.ts"
import { resetDom } from "./dom.ts"

describe("router", () => {
    beforeEach(() => resetDom())

    it("round-trips list and favorites gallery origins", () => {
        const listUrl = postHref("/index.php?page=post&s=view&id=7&tags=two%20words", {
            kind: "list",
            tags: "two words",
            pid: 42,
        })
        const favoriteUrl = postHref("/index.php?page=post&s=view&id=8", {
            kind: "favorites",
            uid: 99,
            pid: 50,
        })

        expect(parseRoute(listUrl)).toEqual({
            type: "postdetails",
            id: 7,
            tags: "two words",
            origin: { kind: "list", tags: "two words", pid: 42 },
        })
        expect(parseRoute(favoriteUrl)).toEqual({
            type: "postdetails",
            id: 8,
            tags: undefined,
            origin: { kind: "favorites", uid: 99, pid: 50 },
        })
    })

    it("encodes user input and rejects malformed identifiers", () => {
        expect(routeToUrl({ type: "postlist", tags: "a+b c", pid: 0 })).toBe(
            "/index.php?page=post&s=list&tags=a%2Bb%20c",
        )
        expect(parseRoute("?page=post&s=view&id=-2")).toEqual({ type: "unknown" })
        expect(parseRoute("?page=favorites&s=view&id=not-a-number")).toEqual({ type: "unknown" })
    })
})

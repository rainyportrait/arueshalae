import { describe, expect, it } from "vitest"

import { parseSessionAlive } from "../../src/api/auth.ts"
import { fixture } from "../helpers/fixture.ts"

describe("parseSessionAlive", () => {
    it("matches the logged-in user's account home", () => {
        const document = fixture("account-home.html")

        expect(parseSessionAlive(document, 42)).toBe(true)
    })

    it("does not match a different user id", () => {
        const document = fixture("account-home.html")

        expect(parseSessionAlive(document, 41)).toBe(false)
    })

    it("does not match the not-logged-in page", () => {
        // The page carries an Everyone's Favorites (s=list) link: the
        // session marker is pinned to s=view and the user id, so it must
        // not read it as the user's own favorites link.
        const document = fixture("account-not-logged-in.html")

        expect(parseSessionAlive(document, 42)).toBe(false)
    })
})

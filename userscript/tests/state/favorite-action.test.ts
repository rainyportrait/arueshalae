import van from "vanjs-core"
import { describe, expect, it } from "vitest"

import { addFavoriteWithStatus } from "../../src/state/favorite-action.ts"
import { deferred } from "../helpers/deferred.ts"

describe("addFavoriteWithStatus", () => {
    it("ignores a success that belongs to a post left during the request", async () => {
        const request = deferred<{ ok: true }>()
        const favorite = van.state<"idle" | "adding" | "added" | "already">("idle")
        let current = true

        const completion = addFavoriteWithStatus(
            1,
            favorite,
            () => current,
            () => request.promise,
        )
        expect(favorite.val).toBe("adding")
        current = false
        favorite.val = "idle" // the details shell reset for the next post
        request.resolve({ ok: true })
        await completion

        expect(favorite.val).toBe("idle")
    })

    it("does not reset a newer request when the old request fails", async () => {
        const gate = deferred<void>()
        const failingRequest = async () => {
            await gate.promise
            throw new Error("failed")
        }
        const favorite = van.state<"idle" | "adding" | "added" | "already">("idle")
        let current = true

        const completion = addFavoriteWithStatus(1, favorite, () => current, failingRequest)
        current = false
        favorite.val = "adding" // another post now owns the shared status
        gate.resolve()
        await completion

        expect(favorite.val).toBe("adding")
    })

    it("publishes the result while the original post is still current", async () => {
        const favorite = van.state<"idle" | "adding" | "added" | "already">("idle")

        await addFavoriteWithStatus(
            1,
            favorite,
            () => true,
            () => Promise.resolve({ ok: false, reason: "already-in-favorites" }),
        )

        expect(favorite.val).toBe("already")
    })
})

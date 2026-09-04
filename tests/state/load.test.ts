import van from "vanjs-core"
import { describe, expect, it } from "vitest"

import { type Loadable, createLoader } from "../../userscript/state/load.ts"
import { deferred } from "../helpers/deferred.ts"

describe("createLoader", () => {
    it("only publishes the latest request and keeps pending until it settles", async () => {
        const state = van.state<Loadable<{ value: string }>>({ status: "loading" })
        const first = deferred<{ value: string }>()
        const second = deferred<{ value: string }>()
        const fetcher = (name: string) => (name === "first" ? first.promise : second.promise)
        const { load, pending } = createLoader(state, fetcher)

        load("first")
        load("second")
        first.resolve({ value: "stale" })
        await first.promise

        expect(pending.val).toBe(true)
        expect(state.val).toEqual({ status: "loading" })

        second.resolve({ value: "current" })
        await second.promise
        await Promise.resolve()

        expect(pending.val).toBe(false)
        expect(state.val).toEqual({ status: "ready", value: "current" })
    })

    it("turns a rejection into an error state", async () => {
        const state = van.state<Loadable<{ value: string }>>({ status: "loading" })
        const request = deferred<{ value: string }>()
        const { load, pending } = createLoader(state, () => request.promise)

        load(undefined)
        request.reject(new Error("network failed"))
        await expect(request.promise).rejects.toThrow("network failed")
        await Promise.resolve()

        expect(pending.val).toBe(false)
        expect(state.val).toEqual({ status: "error", error: "network failed" })
    })
})

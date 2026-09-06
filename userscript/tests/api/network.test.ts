import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../src/captcha.ts", () => ({ isChallengeBody: () => false, solveCaptcha: vi.fn() }))

describe("background request scheduling", () => {
    beforeEach(() => {
        vi.resetModules()
        vi.useFakeTimers()
        vi.setSystemTime(0)
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it("gives interactive requests the next paced slot", async () => {
        const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"))
        vi.stubGlobal("fetch", fetch)
        const network = await import("../../src/api/network.ts")
        const background = network.fetchBackground("/background")
        const interactive = network.fetchCleared("/interactive")
        await vi.advanceTimersByTimeAsync(350)
        expect(fetch.mock.calls[0]?.[0]).toBe("/interactive")
        await vi.advanceTimersByTimeAsync(350)
        await Promise.all([background, interactive])
        expect(fetch.mock.calls[1]?.[0]).toBe("/background")
    })

    it("does not start a queued request after its worker stops", async () => {
        const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"))
        vi.stubGlobal("fetch", fetch)
        const { fetchBackground } = await import("../../src/api/network.ts")
        let current = true
        const pending = fetchBackground("/background", () => current)
        const rejected = expect(pending).rejects.toThrow("worker stopped")
        current = false
        await vi.advanceTimersByTimeAsync(350)
        await rejected
        expect(fetch).not.toHaveBeenCalled()
    })
})

import { afterEach, describe, expect, it, vi } from "vitest"

import { solveCaptcha } from "../../src/captcha.ts"
import { Rule34Reader } from "../../src/sync/rule34.ts"

vi.mock("../../src/captcha.ts", () => ({
    isChallengeBody: (body: string) => body === "challenge",
    solveCaptcha: vi.fn(() => Promise.resolve()),
}))

describe("Rule34Reader", () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
    })

    it("backs off and counts every retry attempt", async () => {
        vi.useFakeTimers()
        const fetch = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response("", { status: 429, headers: { "Retry-After": "0" } }),
            )
            .mockResolvedValueOnce(new Response("", { status: 404 }))
        const attempts = vi.fn()

        const result = new Rule34Reader(42).withRequestBudget(attempts).postDetails(123)
        await vi.runAllTimersAsync()

        await expect(result).resolves.toBeNull()
        expect(fetch).toHaveBeenCalledTimes(2)
        expect(attempts).toHaveBeenCalledTimes(2)
    })

    it("surfaces a challenge through the regular captcha solver", async () => {
        vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response("challenge", { status: 403 }))
            .mockResolvedValueOnce(new Response("", { status: 404 }))
        const attempts = vi.fn()

        await expect(
            new Rule34Reader(42).withRequestBudget(attempts).postDetails(123),
        ).resolves.toBeNull()

        expect(solveCaptcha).toHaveBeenCalledWith("/index.php?page=post&s=view&id=123")
        expect(attempts).toHaveBeenCalledTimes(2)
    })
})

import { describe, expect, it, vi } from "vitest"

import { installRule34PlayerSuppression, suppressRule34Player } from "../src/fluid-player.ts"

describe("suppressRule34Player", () => {
    it("leaves Rule34's video element unenhanced", () => {
        const pageWindow = {} as Window & { fluidPlayer?: (...args: unknown[]) => unknown }
        const fluidPlayer = vi.fn(() => ({ play: vi.fn() }))

        installRule34PlayerSuppression(pageWindow)
        pageWindow.fluidPlayer = fluidPlayer
        const player = pageWindow.fluidPlayer("gelcomVideoPlayer") as { play(): void }
        player.play()

        expect(fluidPlayer).not.toHaveBeenCalled()
    })

    it("passes unrelated players through", () => {
        const pageWindow = {} as Window & { fluidPlayer?: (...args: unknown[]) => unknown }
        const expected = { play: vi.fn() }
        const fluidPlayer = vi.fn(() => expected)

        installRule34PlayerSuppression(pageWindow)
        pageWindow.fluidPlayer = fluidPlayer

        expect(pageWindow.fluidPlayer("anotherVideo")).toBe(expected)
        expect(fluidPlayer).toHaveBeenCalledWith("anotherVideo")
    })

    it("injects the suppression into the page realm", () => {
        suppressRule34Player()

        expect(document.querySelector("script")).toBeNull()
    })
})

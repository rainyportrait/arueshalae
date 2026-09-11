import { beforeEach, describe, expect, it, vi } from "vitest"

import { flushVan, resetDom } from "../dom.ts"

// Mounting Settings with the server enabled pulls in SyncSettings (whose
// import-time derive refreshes the sync status) and the page's own automatic
// prune count check. Keep all of it off the network.
const api = vi.hoisted(() => ({
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    getPruneCount: vi.fn(),
    getSyncStatus: vi.fn(),
    pruneUnfavoritedPosts: vi.fn(),
}))

vi.mock("../../src/api/server.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    getPruneCount: api.getPruneCount,
    pruneUnfavoritedPosts: api.pruneUnfavoritedPosts,
}))
vi.mock("../../src/api/sync.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    getSyncStatus: api.getSyncStatus,
}))

async function importAll() {
    const { Settings } = await import("../../src/Settings.ts")
    const { serverSettings } = await import("../../src/state/settings.ts")
    return { Settings, serverSettings }
}

// The prune block is the bordered footer of the server section: heading and
// description in one div, the button in the next sibling.
function pruneButton(root: HTMLElement): HTMLButtonElement {
    const heading = [...root.querySelectorAll("p")].find(
        (p) => p.textContent === "Prune unfavorited posts",
    )
    if (heading === undefined) throw new Error("prune section not found")
    const block = heading.parentElement?.parentElement
    const button = block?.querySelector<HTMLButtonElement>("button") ?? null
    if (button === null) throw new Error("prune button not found")
    return button
}

function click(element: Element): void {
    element.dispatchEvent(new Event("click"))
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function mount(): Promise<HTMLElement> {
    const m = await importAll()
    m.serverSettings.val = { ...m.serverSettings.val, enabled: true }
    const root = m.Settings()
    document.body.append(root)
    await flushVan()
    return root
}

describe("Settings prune confirmation", () => {
    beforeEach(() => {
        vi.resetModules()
        api.checkDownloads.mockReset()
        api.getDownloadCount.mockReset()
        api.getPruneCount.mockReset()
        api.getSyncStatus.mockReset()
        api.pruneUnfavoritedPosts.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        api.getDownloadCount.mockResolvedValue(0)
        api.getPruneCount.mockResolvedValue(3)
        api.getSyncStatus.mockResolvedValue({
            favorites: 0,
            pending: 0,
            initialized: false,
            countOffset: 0,
            lastSyncAt: null,
        })
        api.pruneUnfavoritedPosts.mockResolvedValue(2)
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("arms on the first click and ignores a fast double click", async () => {
        const root = await mount()
        const button = pruneButton(root)
        expect(button.textContent).toBe("Prune 3 posts")

        click(button)
        await flushVan()
        expect(button.textContent).toBe("Are you sure?")
        expect(api.pruneUnfavoritedPosts).not.toHaveBeenCalled()

        // An accidental second click arrives well inside the guard window.
        click(button)
        await flushVan()
        expect(button.textContent).toBe("Are you sure?")
        expect(api.pruneUnfavoritedPosts).not.toHaveBeenCalled()
    })

    it("runs the prune on a second click once the guard has passed", async () => {
        const root = await mount()
        const button = pruneButton(root)

        // Hold the prune open so the "Pruning…" state is observable.
        let resolvePrune: (count: number) => void = () => {}
        api.pruneUnfavoritedPosts.mockImplementation(
            () => new Promise<number>((resolve) => (resolvePrune = resolve)),
        )

        click(button)
        await flushVan()
        // The guard window is 500 ms; wait past it.
        await sleep(650)

        click(button)
        await flushVan()
        expect(button.textContent).toBe("Pruning…")
        expect(api.pruneUnfavoritedPosts).toHaveBeenCalledTimes(1)

        resolvePrune(2)
        await flushVan()
        await flushVan()
        expect(button.textContent).toBe("Check again")
        expect(root.textContent).toContain("Pruned 2 posts.")
    })

    it("expires the confirmation so it cannot fire much later", async () => {
        const root = await mount()
        const button = pruneButton(root)

        vi.useFakeTimers()
        try {
            click(button)
            await vi.advanceTimersByTimeAsync(0)
            expect(button.textContent).toBe("Are you sure?")

            // The confirmation is only valid for a few seconds.
            await vi.advanceTimersByTimeAsync(4_000)
            expect(button.textContent).toBe("Prune 3 posts")
        } finally {
            vi.useRealTimers()
        }
    })
})

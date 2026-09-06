import { beforeEach, describe, expect, it, vi } from "vitest"

import type { Post } from "../../src/api/post-list.ts"
import { flushVan, resetDom } from "../dom.ts"

// PostCard's chain pulls in state/downloaded.ts, whose triggers would talk
// to the server; and sitting on a favorites route would fire the favorites
// page's loaders. Keep all of it off the network.
const api = vi.hoisted(() => ({
    checkDownloads: vi.fn(),
    getDownloadCount: vi.fn(),
    fetchFavorites: vi.fn(),
    fetchProfile: vi.fn(async () => ({ favorites: 0 })),
}))

vi.mock("../../src/api/server.ts", () => ({
    checkDownloads: api.checkDownloads,
    getDownloadCount: api.getDownloadCount,
    ServerError: class ServerError extends Error {},
}))
vi.mock("../../src/api/favorites.ts", () => ({ fetchFavorites: api.fetchFavorites }))
vi.mock("../../src/api/auth.ts", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    fetchProfile: api.fetchProfile,
}))

function post(id: number): Post {
    return {
        id,
        link: `/index.php?page=post&s=view&id=${id}`,
        thumbnail: `//cdn.example/${id}.jpg`,
        tags: [],
    }
}

async function importAll() {
    const { PostCard } = await import("../../src/PostCard.ts")
    const { route } = await import("../../src/router.ts")
    const { auth } = await import("../../src/state/auth.ts")
    const { downloaded } = await import("../../src/state/downloaded.ts")
    const { serverSettings } = await import("../../src/state/settings.ts")
    return { PostCard, route, auth, downloaded, serverSettings }
}

// Mount a single card on the settings route (the card's link falls back to
// the site's bare href there) and wait for the live bindings to run.
async function mountCard(
    m: Awaited<ReturnType<typeof importAll>>,
    id: number,
): Promise<HTMLElement> {
    const card = m.PostCard(post(id))
    document.body.append(card)
    await flushVan()
    return card
}

function badge(card: HTMLElement): HTMLElement | null {
    return card.querySelector<HTMLElement>('span[icon-name="heart"]')
}

async function enableServer(
    m: Awaited<ReturnType<typeof importAll>>,
    enabled: boolean,
): Promise<void> {
    m.serverSettings.val = { ...m.serverSettings.val, enabled }
    await flushVan()
}

describe("PostCard library badge", () => {
    beforeEach(() => {
        vi.resetModules()
        api.checkDownloads.mockReset()
        api.getDownloadCount.mockReset()
        api.fetchFavorites.mockReset()
        api.checkDownloads.mockResolvedValue(new Set())
        resetDom("https://rule34.xxx/index.php?page=account&s=options")
    })

    it("shows a heart for a post the server holds, hidden otherwise", async () => {
        const m = await importAll()
        await enableServer(m, true)
        m.downloaded.val = new Set([1])

        const card = await mountCard(m, 1)
        const other = await mountCard(m, 2)

        const heart = badge(card)
        expect(heart).not.toBeNull()
        // The title lives on the badge's corner-darkening wrapper, which is
        // also the hover target.
        expect(heart?.closest("span[title]")?.getAttribute("title")).toBe("In your library")
        expect(badge(other)).toBeNull()
    })

    it("adds the badge in place when the check settles, without swapping the image", async () => {
        const m = await importAll()
        await enableServer(m, true)

        const card = await mountCard(m, 1)
        const img = card.querySelector("img")
        expect(img).not.toBeNull()
        expect(badge(card)).toBeNull()

        m.downloaded.val = new Set([1])
        await flushVan()

        expect(badge(card)).not.toBeNull()
        // The img node is the same object: a swap would have reloaded it.
        expect(card.querySelector("img")).toBe(img)
    })

    it("hides the badge when the server is toggled off, keeping the result", async () => {
        const m = await importAll()
        await enableServer(m, true)
        m.downloaded.val = new Set([1])
        const card = await mountCard(m, 1)
        expect(badge(card)).not.toBeNull()

        await enableServer(m, false)

        expect(badge(card)).toBeNull()
        expect(m.downloaded.val.has(1)).toBe(true)
    })

    it("hides the badge on the logged-in user's own favorites page", async () => {
        const m = await importAll()
        await enableServer(m, true)
        m.downloaded.val = new Set([1])
        m.route.val = { type: "favorites", id: 7, pid: 0 }
        m.auth.val = { status: "authenticated", userId: 7 }

        const card = await mountCard(m, 1)

        expect(badge(card)).toBeNull()
    })

    it("keeps the badge on someone else's favorites page", async () => {
        const m = await importAll()
        await enableServer(m, true)
        m.downloaded.val = new Set([1])
        m.route.val = { type: "favorites", id: 8, pid: 0 }
        m.auth.val = { status: "authenticated", userId: 7 }

        const card = await mountCard(m, 1)

        expect(badge(card)).not.toBeNull()
    })

    it("shows the badge for guests browsing a favorites page", async () => {
        const m = await importAll()
        await enableServer(m, true)
        m.downloaded.val = new Set([1])
        m.route.val = { type: "favorites", id: 8, pid: 0 }

        const card = await mountCard(m, 1)

        expect(badge(card)).not.toBeNull()
    })
})

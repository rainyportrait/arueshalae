import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ServerError, checkDownloads, getDownloadCount } from "../../src/api/server.ts"
import { resetDom } from "../dom.ts"

// The client goes through the global fetch; a stub stands in so no request
// ever leaves the process.
type FetchCall = { url: string; init: RequestInit }

function mockFetch(
    calls: FetchCall[],
    respond: (url: string | URL, init: RequestInit) => Response,
): void {
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string | URL, init: RequestInit): Promise<Response> => {
            calls.push({ url: url.toString(), init })
            return respond(url, init)
        }),
    )
}

function jsonResponse(payload: unknown): Response {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => payload,
    } as Response
}

describe("server client", () => {
    let calls: FetchCall[]

    beforeEach(() => {
        resetDom()
        calls = []
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("posts the ids to /check and returns the downloaded subset", async () => {
        mockFetch(calls, () => jsonResponse({ downloaded: [3], notDownloaded: [1, 2] }))

        await expect(checkDownloads([1, 2, 3])).resolves.toEqual(new Set([3]))

        expect(calls).toHaveLength(1)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/check")
        expect(calls[0]?.init.method).toBe("POST")
        expect(calls[0]?.init.headers).toEqual({ "Content-Type": "application/json" })
        expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ postIds: [1, 2, 3] })
    })

    it("survives an all-absent answer with an empty set", async () => {
        mockFetch(calls, () => jsonResponse({ downloaded: [], notDownloaded: [1] }))

        await expect(checkDownloads([1])).resolves.toEqual(new Set())
    })

    it("throws ServerError when the server is unreachable", async () => {
        mockFetch(calls, () => {
            throw new TypeError("fetch failed")
        })

        await expect(checkDownloads([1])).rejects.toBeInstanceOf(ServerError)
    })

    it("throws ServerError on a non-2xx answer", async () => {
        mockFetch(
            calls,
            () => ({ ok: false, status: 500, statusText: "Internal Server Error" }) as Response,
        )

        await expect(checkDownloads([1])).rejects.toThrow("500")
    })

    it("throws ServerError without a configured URL", async () => {
        const { serverSettings } = await import("../../src/state/settings.ts")
        const previous = serverSettings.val
        serverSettings.val = { enabled: true, url: "" }
        mockFetch(calls, () => jsonResponse({}))

        try {
            await expect(checkDownloads([1])).rejects.toBeInstanceOf(ServerError)
            expect(calls).toHaveLength(0)
        } finally {
            serverSettings.val = previous
        }
    })

    it("reads the download count for the settings-page connection test", async () => {
        mockFetch(calls, () => jsonResponse({ count: 42 }))

        await expect(getDownloadCount()).resolves.toBe(42)
        expect(calls[0]?.url).toBe("http://127.0.0.1:34343/count")
    })
})

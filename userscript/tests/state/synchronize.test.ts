import { beforeEach, describe, expect, it, vi } from "vitest"

import { syncCommand } from "../../src/api/sync.ts"
import { synchronize } from "../../src/sync/synchronize.ts"

vi.mock("../../src/api/sync.ts", () => ({ syncCommand: vi.fn() }))

const command = vi.mocked(syncCommand)

describe("explicit synchronization", () => {
    beforeEach(() => command.mockReset())

    it("uses a complete first page as the initial baseline", async () => {
        command.mockResolvedValueOnce({ ids: [], initialized: false, countOffset: 0 })
        command.mockResolvedValueOnce({ ok: true })
        const reader = fakeReader([3, 2, 1])

        await expect(synchronize(reader, () => {})).resolves.toBe(3)
        expect(command).toHaveBeenLastCalledWith("reconcile", {
            ids: [3, 2, 1],
            deleted: [],
            reportedCount: 3,
        })
    })

    it("uses ordered reconciliation and classifies a disappeared post", async () => {
        const baseline = Array.from({ length: 250 }, (_, index) => 500 - index)
        const disappeared = baseline[149] as number
        const remote = [900, ...baseline.filter((postId) => postId !== disappeared)]
        command.mockResolvedValueOnce({ ids: baseline, initialized: true, countOffset: 0 })
        command.mockResolvedValueOnce({ ok: true })
        const reader = fakeReader(remote, disappeared)

        await expect(synchronize(reader, () => {})).resolves.toBe(250)
        expect(command).toHaveBeenLastCalledWith("reconcile", {
            ids: remote,
            deleted: [disappeared],
            reportedCount: 250,
        })
    })
})

function fakeReader(ids: number[], deleted?: number) {
    return {
        reportedCount: vi.fn(async () => ids.length),
        favoritesPage: vi.fn(async (position: number) => ({
            ids: ids.slice(position, position + 50),
            lastPosition: Math.floor(Math.max(0, ids.length - 1) / 50) * 50,
        })),
        postDetails: vi.fn(async (postId: number) => (postId === deleted ? null : { id: postId })),
    } as never
}

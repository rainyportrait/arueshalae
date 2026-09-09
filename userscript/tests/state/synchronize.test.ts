import { beforeEach, describe, expect, it, vi } from "vitest"

import type { PostDetails } from "../../src/api/post-details.ts"
import { syncCommand } from "../../src/api/sync.ts"
import type { Rule34Reader } from "../../src/sync/rule34.ts"
import { synchronize } from "../../src/sync/synchronize.ts"
import { deferred } from "../helpers/deferred.ts"

vi.mock("../../src/api/sync.ts", () => ({ syncCommand: vi.fn() }))

const command = vi.mocked(syncCommand)

describe("explicit synchronization", () => {
    beforeEach(() => command.mockReset())

    it("uses a complete first page as the initial baseline", async () => {
        command.mockResolvedValueOnce({ ids: [], initialized: false, countOffset: 0, revision: 0 })
        command.mockResolvedValueOnce({ ok: true })
        const reader = fakeReader([3, 2, 1])

        await expect(synchronize(reader, () => {})).resolves.toBe(3)
        expect(command).toHaveBeenLastCalledWith("reconcile", {
            ids: [3, 2, 1],
            deleted: [],
            reportedCount: 3,
            revision: 0,
        })
    })

    it("uses ordered reconciliation and classifies a disappeared post", async () => {
        const baseline = Array.from({ length: 250 }, (_, index) => 500 - index)
        const disappeared = baseline[149] as number
        const remote = [900, ...baseline.filter((postId) => postId !== disappeared)]
        command.mockResolvedValueOnce({
            ids: baseline,
            initialized: true,
            countOffset: 0,
            revision: 7,
        })
        command.mockResolvedValueOnce({ ok: true })
        const reader = fakeReader(remote, disappeared)

        await expect(synchronize(reader, () => {})).resolves.toBe(250)
        expect(command).toHaveBeenLastCalledWith("reconcile", {
            ids: remote,
            deleted: [disappeared],
            reportedCount: 250,
            revision: 7,
        })
    })

    it("verifies a one-page observation before publishing it", async () => {
        command.mockResolvedValueOnce({ ids: [], initialized: false, countOffset: 0, revision: 0 })
        const reader = fakeReader([3, 2, 1])
        reader.reportedCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2)

        await expect(synchronize(reader, () => {})).rejects.toThrow(
            "Favorites changed during synchronization",
        )
        expect(command).toHaveBeenCalledTimes(1)
    })

    it("verifies after classifying removals", async () => {
        command.mockResolvedValueOnce({
            ids: [3, 2, 1],
            initialized: true,
            countOffset: 0,
            revision: 0,
        })
        const removal = deferred<PostDetails | null>()
        const reader = fakeReader([3, 2])
        reader.postDetails.mockReturnValueOnce(removal.promise)

        const run = synchronize(reader, () => {})
        await vi.waitFor(() => expect(reader.postDetails).toHaveBeenCalledWith(1))
        expect(reader.reportedCount).toHaveBeenCalledTimes(1)
        removal.resolve({ id: 1 } as PostDetails)
        await run

        expect(reader.reportedCount).toHaveBeenCalledTimes(2)
        expect(command).toHaveBeenLastCalledWith("reconcile", expect.anything())
    })
})

function fakeReader(ids: number[], deleted?: number) {
    const reader = {
        reportedCount: vi.fn(async () => ids.length),
        favoritesPage: vi.fn(async (position: number) => ({
            ids: ids.slice(position, position + 50),
            lastPosition: Math.floor(Math.max(0, ids.length - 1) / 50) * 50,
        })),
        postDetails: vi.fn(async (postId: number) => (postId === deleted ? null : { id: postId })),
    }
    return reader as typeof reader & Rule34Reader
}

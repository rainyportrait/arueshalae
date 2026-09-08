import { describe, expect, it } from "vitest"

import { missingBefore, reconcilePrefix, reconcileRemovals } from "../../src/sync/reconcile.ts"

describe("ordered reconciliation", () => {
    it("moves re-added favorites to the front without inventing new membership", () => {
        expect(reconcilePrefix([1, 2, 3, 4, 5, 6], [2, 1, 3])).toEqual([2, 1, 3, 4, 5, 6])
    })

    it("locates multiple missing entries between surviving anchors", () => {
        expect(missingBefore([1, 2, 3, 4, 5], 1, 4)).toEqual([2, 3])
    })

    it("rejects a missing anchor instead of guessing removals", () => {
        expect(() => missingBefore([1, 2, 3], 1, 8)).toThrow("contradicts")
        expect(() => missingBefore([1, 2, 3], 2, 1)).toThrow("contradicts")
    })
})

describe("binary search against a stable ordered baseline", () => {
    it("finds removals across page boundaries", async () => {
        for (let seed = 1; seed <= 60; seed++) {
            const baseline = Array.from({ length: 150 + seed }, (_, i) => i + 1)
            const removed = baseline.filter((id) => (id + seed) % 17 === 0)
            const moved = baseline
                .filter((id) => (id + seed) % 53 === 0 && !removed.includes(id))
                .reverse()
            const remote = [
                1000 + seed,
                ...moved,
                ...baseline.filter((id) => !removed.includes(id) && !moved.includes(id)),
            ]
            const front = remote.slice(0, 50)
            const found: number[] = []
            const result = await reconcileRemovals(
                reconcilePrefix(baseline, front),
                front.length,
                remote.length,
                async (offset) => remote.slice(offset, offset + 50),
                async (ids) => {
                    found.push(...ids)
                },
            )
            expect(result).toEqual(remote)
            expect(found.sort((a, b) => a - b)).toEqual(removed)
        }
    })

    it("propagates page failures without publishing guessed removals", async () => {
        const baseline = Array.from({ length: 200 }, (_, i) => i + 1)
        await expect(
            reconcileRemovals(
                baseline,
                50,
                199,
                async () => {
                    throw new Error("page failed")
                },
                async () => {},
            ),
        ).rejects.toThrow("page failed")
    })
})

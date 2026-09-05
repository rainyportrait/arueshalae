import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AutocompleteSuggestion } from "../../src/api/autocomplete.ts"
import { resetDom } from "../dom.ts"
import { deferred } from "../helpers/deferred.ts"

const api = vi.hoisted(() => ({ fetchAutocomplete: vi.fn() }))
vi.mock("../../src/api/autocomplete.ts", () => ({
    fetchAutocomplete: api.fetchAutocomplete,
}))

const result: AutocompleteSuggestion[] = [
    { label: "cat ears (100)", value: "cat_ears", type: "general" },
]

describe("AutocompleteInput", () => {
    beforeEach(() => {
        resetDom()
        api.fetchAutocomplete.mockReset()
        vi.useFakeTimers()
    })

    afterEach(() => vi.useRealTimers())

    async function makeInput(): Promise<HTMLInputElement> {
        const { AutocompleteInput } = await import("../../src/AutocompleteInput.ts")
        const component = AutocompleteInput({ placeholder: "tags", ariaLabel: "Tags" })
        document.body.append(component)
        return component.querySelector("input")!
    }

    function type(input: HTMLInputElement, value: string): void {
        input.value = value
        input.selectionStart = value.length
        input.selectionEnd = value.length
        input.dispatchEvent(new Event("input", { bubbles: true }))
    }

    it("does not reopen results after the query is cleared", async () => {
        const request = deferred<AutocompleteSuggestion[]>()
        api.fetchAutocomplete.mockReturnValue(request.promise)
        const input = await makeInput()

        type(input, "cat")
        await vi.advanceTimersByTimeAsync(150)
        expect(api.fetchAutocomplete).toHaveBeenCalledWith("cat")

        type(input, "")
        request.resolve(result)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(0)

        expect(document.querySelector('[role="listbox"]')).toBeNull()
    })

    it("hides prior options while a replacement query is debounced", async () => {
        api.fetchAutocomplete.mockResolvedValueOnce(result)
        const next = deferred<AutocompleteSuggestion[]>()
        api.fetchAutocomplete.mockReturnValueOnce(next.promise)
        const input = await makeInput()

        type(input, "cat")
        await vi.advanceTimersByTimeAsync(150)
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(document.querySelector('[role="option"]')?.textContent).toContain("cat ears")

        type(input, "dog")
        await vi.advanceTimersByTimeAsync(0)

        expect(document.querySelector('[role="listbox"]')).toBeNull()
        expect(api.fetchAutocomplete).toHaveBeenCalledTimes(1)
    })
})

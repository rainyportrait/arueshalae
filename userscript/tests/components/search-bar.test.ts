import { beforeEach, describe, expect, it, vi } from "vitest"

import { resetDom } from "../dom.ts"

describe("SearchBar", () => {
    beforeEach(() => {
        vi.resetModules()
        resetDom()
    })

    async function mountSearchBar(): Promise<{ form: HTMLFormElement; input: HTMLInputElement }> {
        const { SearchBar } = await import("../../src/SearchBar.ts")
        const form = SearchBar()
        document.body.append(form)
        return { form, input: form.querySelector("input")! }
    }

    it.each([
        [
            "Enter",
            (form: HTMLFormElement, input: HTMLInputElement) => {
                const event = new Event("keydown", { bubbles: true, cancelable: true })
                Object.assign(event, { key: "Enter" })
                input.dispatchEvent(event)
            },
        ],
        [
            "the submit button",
            (form: HTMLFormElement) => {
                form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
            },
        ],
    ])("blurs the field after submitting with %s", async (_label, submit) => {
        const { form, input } = await mountSearchBar()
        input.value = "  CAT_EARS  "
        input.setSelectionRange = vi.fn()
        input.focus()
        const blur = vi.spyOn(input, "blur")

        submit(form, input)

        expect(blur).toHaveBeenCalledOnce()
        expect(input.value).toBe("cat_ears")
    })
})

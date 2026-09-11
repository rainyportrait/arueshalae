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

    it("uses compact icon controls and the shared placeholder", async () => {
        const { form, input } = await mountSearchBar()

        expect(input.placeholder).toBe("search rule34 using tags")
        expect(form.querySelector('button[type="submit"]')?.textContent).toBe("")
        expect(form.querySelector('button[type="submit"] [icon-name="search"]')).not.toBeNull()
        expect(form.querySelector('button[type="button"] [icon-name="globe"]')).not.toBeNull()
    })

    it("toggles between site and favorite search", async () => {
        const { auth } = await import("../../src/state/auth.ts")
        const { serverSettings } = await import("../../src/state/settings.ts")
        auth.val = { status: "authenticated", userId: 42 }
        serverSettings.val = { ...serverSettings.val, enabled: true }
        const { form, input } = await mountSearchBar()
        const scope = form.querySelector<HTMLButtonElement>('button[type="button"]')!

        scope.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(scope.querySelector('[icon-name="heart"]')).not.toBeNull()
        expect(input.placeholder).toBe("search your favorites using tags")
        expect(input.getAttribute("aria-label")).toBe("Search your favorites using tags")

        input.value = "cat_ears"
        input.setSelectionRange = vi.fn()
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
        expect(location.search).toBe("?page=favorites&s=view&id=42&tags=cat_ears")

        await new Promise((resolve) => setTimeout(resolve, 0))
        form.querySelector<HTMLButtonElement>('button[type="button"]')!.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(form.querySelector('button[type="button"] [icon-name="globe"]')).not.toBeNull()
        expect(input.placeholder).toBe("search rule34 using tags")
    })
})

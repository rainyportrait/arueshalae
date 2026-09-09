import van from "vanjs-core"

import { AutocompleteInput } from "./AutocompleteInput.ts"
import { normalizeTags } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { route } from "./router.ts"
import { search } from "./state/list.ts"
import { registerSearchField } from "./state/search-field.ts"

const { button, form } = van.tags

// A search query is the normalized tag list rejoined into a single
// space-separated string. Normalization happens only when the search is sent,
// never per-keystroke, so in-progress editing (mixed case, stray spaces) is
// left untouched until then.
function normalizeQuery(raw: string): string {
    return normalizeTags(raw).join(" ")
}

export function SearchBar() {
    // The autocomplete input owns the field; we keep a ref to it so we can
    // reflect a normalized query back into the UI on submit, and a resync so
    // its ghost-text overlay picks up the programmatic rewrite.
    const inputRef = { current: null as HTMLInputElement | null }
    const resyncRef = { current: null as (() => void) | null }

    // The field is created before the derive so the derive's immediate
    // first run already finds the ref set — otherwise a direct load of a
    // tagged list URL would only fill the field on the next navigation.
    const field = AutocompleteInput({
        icon: "search",
        placeholder: "Search using tags (e.g. blonde_hair)",
        ariaLabel: "Search using tags",
        onEnter: submit,
        inputRef,
        resyncRef,
    })

    // The tag sidebar's + buttons reach this field through the module channel
    // (state/search-field.ts): they append a tag without submitting.
    if (inputRef.current !== null && resyncRef.current !== null)
        registerSearchField(inputRef.current, resyncRef.current)

    // Keep the field in step with the query carried by the route: direct
    // loads of a tagged list URL, back/forward, and post links (a
    // postdetails route carries the query the post was found under). Only
    // list/detail routes sync — the field is left alone on other pages.
    // The derive runs only when the route changes, so it never interrupts
    // typing — but navigating to a list or detail page discards whatever
    // unsubmitted text is in the field.
    van.derive(() => {
        const r = route.val
        if (r.type !== "postlist" && r.type !== "postdetails") return
        const input = inputRef.current
        if (!input) return
        const q = r.tags ?? ""
        if (input.value === q) return
        input.value = q
        resyncRef.current?.()
    })

    function submit(): void {
        const input = inputRef.current
        const raw = input?.value ?? ""
        const normalized = normalizeQuery(raw)
        // Reflect the normalization in the UI (not just the request) and move
        // the caret to the end.
        if (input) {
            input.value = normalized
            input.setSelectionRange(normalized.length, normalized.length)
            resyncRef.current?.()
        }
        search(normalized === "" ? undefined : normalized)
    }

    return form(
        {
            class: "flex min-w-0 flex-1 items-center gap-2",
            role: "search",
            // The Search button submits the form; Enter in the field is routed
            // through onEnter (the autocomplete intercepts it). Both land here.
            onsubmit: (e: SubmitEvent) => {
                e.preventDefault()
                submit()
            },
        },
        field,
        // The field already carries a search icon, so the button stays a text
        // label; it just tightens up on narrow screens.
        button(
            {
                type: "submit",
                class: clsx(
                    "shrink-0 rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white sm:px-4",
                    "transition-colors hover:bg-rose-400",
                ),
            },
            "Search",
        ),
    )
}

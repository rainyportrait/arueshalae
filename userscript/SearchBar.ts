import van from "vanjs-core"

import { AutocompleteInput } from "./AutocompleteInput.ts"
import { normalizeTags } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { search } from "./state/list.ts"

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
            class: clsx("flex min-w-0 flex-1 items-center gap-2"),
            role: "search",
            // The Search button submits the form; Enter in the field is routed
            // through onEnter (the autocomplete intercepts it). Both land here.
            onsubmit: (e: SubmitEvent) => {
                e.preventDefault()
                submit()
            },
        },
        AutocompleteInput({
            icon: "search",
            placeholder: "Search using tags (e.g. blonde_hair)",
            ariaLabel: "Search using tags",
            onEnter: submit,
            inputRef,
            resyncRef,
        }),
        button(
            {
                type: "submit",
                class: clsx(
                    "shrink-0 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                    "transition-colors hover:bg-rose-400",
                ),
            },
            "Search",
        ),
    )
}

import van from "vanjs-core/src/van"

import { TAG_META } from "./TagList"
import { type AutocompleteSuggestion, fetchAutocomplete } from "./api/autocomplete"
import clsx from "./clsx"
import { search, tags } from "./state"

const { button, div, form, input, span } = van.tags

// Small pause before firing an autocomplete request, so we don't hit the
// endpoint on every keystroke.
const DEBOUNCE_MS = 150

// Normalize a raw search query: split on whitespace, trim + lowercase each
// token, drop empties, dedupe (preserving first-seen order), rejoin with a
// single space. Applied only when the search is sent, never per-keystroke, so
// in-progress editing (mixed case, stray spaces) is left untouched until then.
function normalizeQuery(raw: string): string {
    const seen = new Set<string>()
    const tokens: string[] = []
    for (const part of raw.split(/\s+/)) {
        const token = part.trim().toLowerCase()
        if (token === "" || seen.has(token)) continue
        seen.add(token)
        tokens.push(token)
    }
    return tokens.join(" ")
}

export function SearchBar() {
    const suggestions = van.state<AutocompleteSuggestion[]>([])
    const highlighted = van.state<number>(-1)
    const visible = van.state(false)

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    // Monotonically increasing id for in-flight requests; a response is only
    // applied if it still matches the latest request (discards out-of-order).
    let fetchSeq = 0

    function dismiss(): void {
        visible.val = false
        suggestions.val = []
        highlighted.val = -1
    }

    // Walk back from the cursor to the nearest space (or index 0). That index
    // is the start of the tag fragment the caret currently sits inside.
    function fragmentStart(el: HTMLInputElement): number {
        const value = el.value
        let start = el.selectionStart ?? value.length
        while (start > 0 && value[start - 1] !== " ") start--
        return start
    }

    function onInput(): void {
        if (debounceTimer) clearTimeout(debounceTimer)
        const value = inputEl.value
        const start = fragmentStart(inputEl)
        const selStart = inputEl.selectionStart ?? value.length
        const fragment = value.slice(start, selStart)
        // A leading `-` marks a "negative" (exclusion) tag. It isn't a valid
        // tag prefix, so strip it for the request but keep it on acceptance.
        const query = fragment.startsWith("-") ? fragment.slice(1) : fragment
        if (query.length === 0) {
            // Caret at the start, right after a space, or a lone `-`: nothing
            // to complete.
            dismiss()
            return
        }
        debounceTimer = setTimeout(() => {
            const seq = ++fetchSeq
            fetchAutocomplete(query)
                .then((items) => {
                    if (seq !== fetchSeq) return
                    suggestions.val = items
                    highlighted.val = -1
                    visible.val = items.length > 0
                })
                .catch(() => {
                    /* transient autocomplete failure: keep whatever is shown */
                })
        }, DEBOUNCE_MS)
    }

    function moveHighlight(dir: 1 | -1): void {
        const len = suggestions.val.length
        if (len === 0) return
        const cur = highlighted.val
        highlighted.val = cur === -1 ? (dir === 1 ? 0 : len - 1) : (cur + dir + len) % len
    }

    // Replace only the active fragment with the chosen tag plus a trailing
    // space, leaving the rest of the query intact, and park the caret just
    // after that space.
    function accept(index: number): void {
        const suggestion = suggestions.val[index]
        if (!suggestion) return
        const value = inputEl.value
        const start = fragmentStart(inputEl)
        const selStart = inputEl.selectionStart ?? value.length
        // Preserve a leading `-` (negative/exclusion tag) across the replace.
        const prefix = value[start] === "-" ? "-" : ""
        inputEl.value =
            value.slice(0, start) + prefix + suggestion.value + " " + value.slice(selStart)
        const cursor = start + prefix.length + suggestion.value.length + 1
        // Replacing the value can reset the caret, so restore focus + selection
        // explicitly after the mutation.
        inputEl.focus()
        inputEl.setSelectionRange(cursor, cursor)
        dismiss()
    }

    function onKeydown(e: KeyboardEvent): void {
        const open = visible.val && suggestions.val.length > 0
        if (!open) return
        switch (e.key) {
            case "ArrowDown":
                e.preventDefault()
                moveHighlight(1)
                break
            case "ArrowUp":
                e.preventDefault()
                moveHighlight(-1)
                break
            case "Enter":
            case "Tab":
                // While open, Enter/Tab accept the completion instead of
                // submitting (Enter) or moving focus (Tab).
                e.preventDefault()
                accept(highlighted.val === -1 ? 0 : highlighted.val)
                break
            case "Escape":
                // Dismiss only; no persistent "suppressed" flag, so the next
                // input re-derives the fragment and reopens if non-empty.
                e.preventDefault()
                visible.val = false
                break
        }
    }

    const inputEl = input({
        name: "tagQuery",
        type: "text",
        placeholder: "Search using tags (e.g. blonde_hair)",
        value: () => tags.val ?? "",
        "aria-label": "Search using tags",
        class: clsx(
            "w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 lowercase",
            "text-sm text-zinc-100 placeholder:text-zinc-500",
            "transition-colors focus:border-rose-500/60 focus:outline-none",
            "focus:ring-2 focus:ring-rose-500/20",
        ),
        oninput: onInput,
        onkeydown: onKeydown,
        onblur: dismiss,
    })

    // The dropdown is a reactive child of the (positioned) input container. It
    // always returns a DOM node: an empty div when hidden, the listbox when
    // shown. Entries show the `label` (which already carries the count) and
    // are colored by tag type, matching TagList.
    const dropdown = () => {
        if (!visible.val || suggestions.val.length === 0) return div()
        const items = suggestions.val
        const hi = highlighted.val
        return div(
            {
                class: clsx(
                    "absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto",
                    "rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-lg",
                ),
                role: "listbox",
            },
            items.map((s, i) =>
                div(
                    {
                        class: clsx(
                            "cursor-pointer px-3 py-1.5 text-sm",
                            TAG_META[s.type].color,
                            i === hi ? "bg-zinc-800" : "hover:bg-zinc-800/60",
                        ),
                        role: "option",
                        "aria-selected": i === hi,
                        // Keep the input focused on mousedown so the click can
                        // land (otherwise blur would dismiss us first).
                        onmousedown: (e: MouseEvent) => e.preventDefault(),
                        onmouseenter: () => {
                            highlighted.val = i
                        },
                        onclick: () => accept(i),
                    },
                    s.label,
                ),
            ),
        )
    }

    return form(
        {
            class: "flex min-w-0 flex-1 items-center gap-2",
            role: "search",
            onsubmit: (e: SubmitEvent) => {
                e.preventDefault()
                const normalized = normalizeQuery(inputEl.value)
                // Reflect the normalization in the UI (not just the request)
                // and move the caret to the end.
                inputEl.value = normalized
                inputEl.setSelectionRange(normalized.length, normalized.length)
                dismiss()
                search(normalized === "" ? undefined : normalized)
            },
        },
        div(
            { class: "relative min-w-0 flex-1" },
            span({
                "icon-name": "search",
                class: "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-zinc-500",
                "aria-hidden": "true",
            }),
            inputEl,
            dropdown,
        ),
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

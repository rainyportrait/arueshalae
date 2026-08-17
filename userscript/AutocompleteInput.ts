import van from "vanjs-core"

import { TAG_META } from "./TagList.ts"
import { type AutocompleteSuggestion, fetchAutocomplete } from "./api/autocomplete.ts"
import clsx from "./clsx.ts"

const { div, input, span } = van.tags

// Small pause before firing an autocomplete request, so we don't hit the
// endpoint on every keystroke.
const DEBOUNCE_MS = 150

export interface AutocompleteInputProps {
    placeholder: string
    ariaLabel: string
    // Optional icon rendered inside the field on the left; the input's
    // left padding is adjusted to match.
    icon?: string
    // Extra classes for the input element.
    inputClass?: string
    // Invoked after a suggestion is accepted. The active fragment has already
    // been replaced with the accepted tag in the input, so a caller that
    // wants to "commit and clear" (e.g. the tag blacklist) can read the input
    // and reset it here.
    onAccept?: (value: string) => void
    // Invoked when Enter is pressed with the dropdown closed, carrying the
    // input's current raw value.
    onEnter?: (value: string) => void
    // If provided, the live input element is stored here once created, so a
    // caller can read or rewrite its value (e.g. to reflect a normalized
    // query back into the field).
    inputRef?: { current: HTMLInputElement | null }
}

// A tag-autocomplete text input: debounced suggestions as you type, keyboard
// navigation, and fragment-aware acceptance (only the tag under the caret is
// replaced, leaving the rest of the query intact). Shared by the navbar search
// bar and the settings tag blacklist; the two differ only in what they do on
// accept/enter, which is delegated to the callbacks.
export function AutocompleteInput({
    placeholder,
    ariaLabel,
    icon,
    inputClass,
    onAccept,
    onEnter,
    inputRef,
}: AutocompleteInputProps): HTMLDivElement {
    const suggestions = van.state<AutocompleteSuggestion[]>([])
    const highlighted = van.state<number>(-1)
    const visible = van.state(false)

    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    // Monotonically increasing id for in-flight requests; a response is only
    // applied if it still matches the latest request (discards out-of-order).
    let fetchSeq = 0

    const inputEl = input({
        type: "text",
        placeholder,
        "aria-label": ariaLabel,
        class: clsx(
            "w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pr-3",
            icon ? "pl-9" : "pl-3",
            "text-sm text-zinc-100 lowercase placeholder:text-zinc-500",
            "transition-colors focus:border-rose-500/60 focus:outline-none",
            "focus:ring-2 focus:ring-rose-500/20",
            inputClass,
        ),
        oninput: onInput,
        onkeydown: onKeydown,
        onblur: dismiss,
    })

    if (inputRef) inputRef.current = inputEl

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
        onAccept?.(suggestion.value)
    }

    function onKeydown(e: KeyboardEvent): void {
        const open = visible.val && suggestions.val.length > 0
        if (open) {
            switch (e.key) {
                case "ArrowDown":
                    e.preventDefault()
                    moveHighlight(1)
                    return
                case "ArrowUp":
                    e.preventDefault()
                    moveHighlight(-1)
                    return
                case "Enter":
                case "Tab":
                    // While open, Enter/Tab accept the completion instead of
                    // submitting (Enter) or moving focus (Tab).
                    e.preventDefault()
                    accept(highlighted.val === -1 ? 0 : highlighted.val)
                    return
                case "Escape":
                    // Dismiss only; no persistent "suppressed" flag, so the
                    // next input re-derives the fragment and reopens.
                    e.preventDefault()
                    visible.val = false
                    return
            }
        } else if (e.key === "Enter") {
            // Dropdown closed: hand the raw value to the caller to commit.
            e.preventDefault()
            onEnter?.(inputEl.value)
        }
    }

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
                    "absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto",
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

    return div(
        { class: clsx("relative min-w-0 flex-1") },
        icon
            ? span({
                  "icon-name": icon,
                  class: clsx(
                      "pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base text-zinc-500",
                  ),
                  "aria-hidden": "true",
              })
            : null,
        inputEl,
        dropdown,
    )
}

import van from "vanjs-core"

import { TAG_META } from "./TagList.ts"
import { type AutocompleteSuggestion, fetchAutocomplete } from "./api/autocomplete.ts"
import clsx from "./clsx.ts"
import { tagBlacklist } from "./state/settings.ts"

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
    // If provided, a function to re-sync the ghost-text overlay after the
    // caller rewrote the input's value programmatically (which fires no
    // native events). Must be called after any external value mutation.
    resyncRef?: { current: (() => void) | null }
}

// A tag-autocomplete text input: debounced suggestions as you type, keyboard
// navigation, and fragment-aware acceptance (only the tag under the caret is
// replaced, leaving the rest of the query intact). Shared by the navbar search
// bar and the settings tag blacklist; the two differ only in what they do on
// accept/enter, which is delegated to the callbacks.
//
// The typed text is rendered by a transparent-text input mirrored by a
// ghost-text overlay (same metrics, absolutely positioned on top), so the
// highlighted suggestion's remainder can be shown inline in a muted color.
// The overlay only re-renders on state changes or a `bump()` from the
// input's events, which is what keeps it in sync with caret movement.
export function AutocompleteInput({
    placeholder,
    ariaLabel,
    icon,
    inputClass,
    onAccept,
    onEnter,
    inputRef,
    resyncRef,
}: AutocompleteInputProps): HTMLDivElement {
    const suggestions = van.state<AutocompleteSuggestion[]>([])
    const highlighted = van.state<number>(-1)
    const visible = van.state(false)
    // Non-value revision counter: bump it whenever the input's text, caret,
    // or scroll position may have changed outside of a state update.
    const rev = van.state(0)
    function bump(): void {
        rev.val++
    }

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
            // The visible text is drawn by the ghost overlay; the input only
            // contributes the caret (and the placeholder, which the overlay
            // leaves uncovered while the value is empty).
            "text-sm text-transparent lowercase caret-zinc-100 placeholder:text-zinc-500",
            "transition-colors focus:border-rose-500/60 focus:outline-none",
            "focus:ring-2 focus:ring-rose-500/20",
            inputClass,
        ),
        oninput: onInput,
        onkeydown: onKeydown,
        // Caret moves that don't change the value (arrows, Home/End, click)
        // need the overlay re-rendered and the fragment re-queried.
        onkeyup: (e: KeyboardEvent) => {
            bump()
            // Horizontal moves change the fragment; Up/Down only navigate the
            // open dropdown and must not trigger a re-fetch (which would reset
            // the highlight).
            if (
                e.key === "ArrowLeft" ||
                e.key === "ArrowRight" ||
                e.key === "Home" ||
                e.key === "End"
            )
                refreshSuggestions()
        },
        onclick: () => {
            bump()
            refreshSuggestions()
        },
        onblur: dismiss,
    })

    if (inputRef) inputRef.current = inputEl
    if (resyncRef) resyncRef.current = bump
    // The input scrolls horizontally when the value overflows; keep the
    // overlay's text scrolled to match.
    inputEl.addEventListener("scroll", bump)

    function clearSuggestions(): void {
        visible.val = false
        suggestions.val = []
        highlighted.val = -1
    }

    function dismiss(): void {
        if (debounceTimer) {
            clearTimeout(debounceTimer)
            debounceTimer = undefined
        }
        // Invalidate both an in-flight request and a request waiting for the
        // debounce timer, so a late response cannot reopen the dropdown.
        fetchSeq++
        clearSuggestions()
    }

    // Walk back from the cursor to the nearest space (or index 0). That index
    // is the start of the tag fragment the caret currently sits inside.
    function fragmentStartOf(value: string, selStart: number): number {
        let start = selStart
        while (start > 0 && value[start - 1] !== " ") start--
        return start
    }

    // Re-derive the fragment under the caret and (re)fetch its suggestions.
    // Shared by typing and caret movement: moving the caret to a different
    // fragment without typing must re-query, or the dropdown (and ghost) stay
    // stale and Tab could accept a suggestion into the wrong fragment.
    function refreshSuggestions(): void {
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = undefined
        const seq = ++fetchSeq
        // The old list belongs to the previous fragment and must not remain
        // available for acceptance while the new query is debounced.
        clearSuggestions()
        const value = inputEl.value
        const selStart = inputEl.selectionStart ?? value.length
        const start = fragmentStartOf(value, selStart)
        const fragment = value.slice(start, selStart)
        // A leading `-` marks a "negative" (exclusion) tag. It isn't a valid
        // tag prefix, so strip it for the request but keep it on acceptance.
        const query = fragment.startsWith("-") ? fragment.slice(1) : fragment
        if (query.length === 0) {
            // Caret at the start, right after a space, or a lone `-`: nothing
            // to complete.
            return
        }
        debounceTimer = setTimeout(() => {
            debounceTimer = undefined
            fetchAutocomplete(query)
                .then((items) => {
                    if (seq !== fetchSeq) return
                    // Never suggest tags the user has blacklisted (exact
                    // match, same convention as `filterByBlacklist`).
                    const blocked = new Set(tagBlacklist.val)
                    suggestions.val = items.filter((s) => !blocked.has(s.value))
                    highlighted.val = -1
                    visible.val = suggestions.val.length > 0
                })
                .catch(() => {
                    /* transient autocomplete failure: keep whatever is shown */
                })
        }, DEBOUNCE_MS)
    }

    function onInput(): void {
        bump()
        refreshSuggestions()
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
        const selStart = inputEl.selectionStart ?? value.length
        const start = fragmentStartOf(value, selStart)
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
        // Programmatic value change: no native input event, re-render the
        // overlay for the new text + caret.
        bump()
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

    // The ghost-text overlay: an invisible sibling that exactly mirrors the
    // input's font, padding, and scroll position, drawing the value in normal
    // color plus the highlighted suggestion's remainder in a muted color,
    // starting at the caret. The transparent border keeps its metrics aligned
    // with the input's own border. It always renders (even without a ghost),
    // since the input's own text is transparent.
    // inline-block: `transform` (used for scroll sync) doesn't apply to
    // plain inline elements.
    const ghostInner = span({ class: "inline-block whitespace-pre" })
    van.derive(() => {
        // Reading rev subscribes us to caret/scroll/external mutations that
        // don't touch any of the reactive state above.
        const _ = rev.val
        const text = inputEl.value
        const caret = inputEl.selectionStart ?? text.length
        const open = visible.val && suggestions.val.length > 0
        let ghostText = ""
        if (open) {
            // Mirror the Enter/Tab fallback: with nothing actively
            // highlighted, the first suggestion is what would be accepted.
            const hi = highlighted.val >= 0 ? highlighted.val : 0
            const s = suggestions.val[hi]
            const frag = text.slice(fragmentStartOf(text, caret), caret)
            // Strip the leading `-` (negative tag) the same way the request
            // does, then only ghost a true remainder of the suggestion.
            const q = frag.startsWith("-") ? frag.slice(1) : frag
            // Case-insensitive: typed text may be mixed case, tags aren't.
            if (s && q !== "" && s.value.toLowerCase().startsWith(q.toLowerCase()))
                ghostText = s.value.slice(q.length)
        }
        ghostInner.style.transform = `translateX(${-inputEl.scrollLeft}px)`
        if (ghostText === "") {
            ghostInner.replaceChildren(text)
        } else {
            ghostInner.replaceChildren(
                text.slice(0, caret),
                span({ class: "text-zinc-600" }, ghostText),
                text.slice(caret),
            )
        }
    })
    const ghost = div(
        {
            class: clsx(
                "pointer-events-none absolute inset-0 overflow-hidden rounded-lg",
                "border border-transparent py-2 pr-3",
                icon ? "pl-9" : "pl-3",
                // Mirror the input's text metrics, including its lowercase
                // transform, or typed capitals would render misaligned.
                "text-sm text-zinc-100 lowercase",
            ),
            "aria-hidden": "true",
        },
        ghostInner,
    )

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
                        // Deliberately no onmouseenter: the highlight is
                        // keyboard-driven only, so passing the cursor over the
                        // dropdown can't make Tab/Enter accept an unwanted tag
                        // (hover:bg above gives visual feedback without
                        // changing the selection).
                        onmousedown: (e: MouseEvent) => e.preventDefault(),
                        onclick: () => accept(i),
                    },
                    s.label,
                ),
            ),
        )
    }

    return div(
        { class: "relative min-w-0 flex-1" },
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
        ghost,
        dropdown,
    )
}

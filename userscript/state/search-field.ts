import { normalizeTags } from "../api/tags.ts"

// A one-way command channel to the navbar's search field. SearchBar registers
// the live input element (and the ghost-overlay resync) here once the field
// exists, and the TagList's + buttons append a tag to the field through
// `appendTagToSearchField` without submitting — the route, and hence the
// loaded page, stays put until the user actually searches. The field is only
// ever mutated, never read reactively, so a plain module slot suffices.
//
// This lives apart from SearchBar (rather than as an export of it) so the tag
// sidebar can reach the field without an import cycle through
// AutocompleteInput, which colors its suggestions from TagList.
let field: { input: HTMLInputElement; resync: () => void } | null = null

export function registerSearchField(input: HTMLInputElement, resync: () => void): void {
    field = { input, resync }
}

// Append a tag to the field. A search query is a set of tags, so a tag the
// field already carries is a no-op. The existing text is otherwise left
// untouched (stray spaces and mixed case normalize only on submit), a
// trailing run of spaces is trimmed first, and the caret parks at the end.
export function appendTagToSearchField(slug: string): void {
    if (field === null) return
    const { input, resync } = field
    if (normalizeTags(input.value).includes(slug)) return
    const trimmed = input.value.trimEnd()
    input.value = trimmed === "" ? slug : `${trimmed} ${slug}`
    input.setSelectionRange(input.value.length, input.value.length)
    // A programmatic value change fires no native event: the ghost-text
    // overlay must be redrawn for the new text and caret.
    resync()
}

import { fetchCleared } from "./network.ts"
import { KNOWN_TYPES, type TagType } from "./tags.ts"

export type AutocompleteSuggestion = {
    label: string
    value: string
    type: TagType
}

// The endpoint HTML-entity-encodes special characters in tag strings (e.g. an
// apostrophe arrives as `&#039;`), so the raw JSON body carries entities
// inside its string values. We decode the whole body in one pass before
// parsing the JSON — one decode per response instead of one per field. A
// detached <textarea> (raw-text content) decodes every entity without any
// part of the body being interpreted as markup, so a tag value containing
// angle brackets can't be swallowed as an element.
function decodeEntities(s: string): string {
    const ta = document.createElement("textarea")
    ta.innerHTML = s
    return ta.value
}

// The autocomplete endpoint returns a JSON array of { label, value, type }.
// `label` already includes the count, `value` is the canonical tag to insert,
// and `type` drives the per-type color. Unknown types fall back to `general`.
export async function fetchAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const url = `/public/autocomplete.php?q=${encodeURIComponent(query)}`
    const response = await fetchCleared(url)
    const raw = await response.text()
    const data: Array<{ label: string; value: string; type: string }> = JSON.parse(
        decodeEntities(raw),
    )
    return data
        .filter((item) => typeof item.value === "string" && item.value !== "")
        .map((item) => ({
            label: item.label ?? item.value,
            value: item.value,
            type: (KNOWN_TYPES.has(item.type) ? item.type : "general") as TagType,
        }))
}

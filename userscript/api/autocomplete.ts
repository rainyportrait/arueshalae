import { fetchCleared } from "./network.ts"
import { KNOWN_TYPES, type TagType } from "./tags.ts"

export type AutocompleteSuggestion = {
    label: string
    value: string
    type: TagType
}

// The endpoint HTML-entity-encodes special characters in tags (e.g. an
// apostrophe arrives as `&#039;`), so both `label` and `value` must be
// decoded before display or insertion. Parsing through the DOM gives a
// faithful, single-pass decode of numeric and named entities.
function decodeEntities(s: string): string {
    return new DOMParser().parseFromString(s, "text/html").documentElement.textContent ?? s
}

// The autocomplete endpoint returns a JSON array of { label, value, type }.
// `label` already includes the count, `value` is the canonical tag to insert,
// and `type` drives the per-type color. Unknown types fall back to `general`.
export async function fetchAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    const url = `/public/autocomplete.php?q=${encodeURIComponent(query)}`
    const response = await fetchCleared(url)
    const data: Array<{ label: string; value: string; type: string }> = await response.json()
    return data
        .filter((item) => typeof item.value === "string" && item.value !== "")
        .map((item) => ({
            label: decodeEntities(item.label ?? item.value),
            value: decodeEntities(item.value),
            type: (KNOWN_TYPES.has(item.type) ? item.type : "general") as TagType,
        }))
}

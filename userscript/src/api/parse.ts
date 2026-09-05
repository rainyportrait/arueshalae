export function queryParam(href: string, key: string): string | null {
    const queryIndex = href.indexOf("?")
    if (queryIndex === -1) return null
    return new URLSearchParams(href.slice(queryIndex + 1)).get(key)
}

export function positiveInt(value: string | null): number | null {
    if (value === null) return null
    const n = Number(value)
    return Number.isInteger(n) && n > 0 ? n : null
}

// The digit count of a raw string ("1,234" -> 1234); 0 when it has none.
export function parseCount(raw: string): number {
    const digits = raw.replace(/[^\d]/g, "")
    return digits === "" ? 0 : Number(digits)
}

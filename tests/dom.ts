import { parseHTML } from "linkedom"

const initialUrl = "https://rule34.xxx/index.php?page=post&s=list"
let currentUrl = new URL(initialUrl)

const parsed = parseHTML("<!doctype html><html><head></head><body></body></html>")
export const testWindow = parsed.window

const testLocation = {
    get href(): string {
        return currentUrl.href
    },
    set href(value: string) {
        currentUrl = new URL(value, currentUrl)
    },
    get origin(): string {
        return currentUrl.origin
    },
    get pathname(): string {
        return currentUrl.pathname
    },
    get search(): string {
        return currentUrl.search
    },
}

const testHistory = {
    pushState(_data: unknown, _unused: string, url?: string | URL | null): void {
        if (url !== undefined && url !== null) currentUrl = new URL(String(url), currentUrl)
    },
    replaceState(_data: unknown, _unused: string, url?: string | URL | null): void {
        if (url !== undefined && url !== null) currentUrl = new URL(String(url), currentUrl)
    },
}

Object.defineProperties(testWindow, {
    history: { configurable: true, value: testHistory },
    location: { configurable: true, value: testLocation },
    scrollTo: { configurable: true, value: () => undefined },
})

export function setTestUrl(url: string): void {
    currentUrl = new URL(url, initialUrl)
}

export function resetDom(url: string = initialUrl): void {
    setTestUrl(url)
    parsed.document.head.replaceChildren()
    parsed.document.body.replaceChildren()
    parsed.document.cookie = ""
    localStorage.clear()
}

export async function flushVan(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
}

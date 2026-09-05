import { parseHTML } from "linkedom"

const initialUrl = "https://rule34.xxx/index.php?page=post&s=list"
let currentUrl = new URL(initialUrl)

// A real-enough history: a stack of {url, state} entries like the browser's,
// so back/forward move between entries and dispatch popstate — the SPA's
// navigation (router) and its scroll memory (state/scroll.ts) both stand on
// this.
type HistoryEntry = { url: URL; state: unknown }
let entries: HistoryEntry[] = [{ url: currentUrl, state: null }]
let entryIndex = 0
let testScrollY = 0

const parsed = parseHTML("<!doctype html><html><head></head><body></body></html>")
const rawWindow = parsed.window

function syncUrl(): void {
    currentUrl = entries[entryIndex].url
}

function targetUrl(url: string | URL | null | undefined): URL {
    return url === undefined || url === null
        ? entries[entryIndex].url
        : new URL(String(url), entries[entryIndex].url)
}

const testHistory = {
    get length(): number {
        return entries.length
    },
    get state(): unknown {
        return entries[entryIndex].state
    },
    pushState(data: unknown, _unused: string, url?: string | URL | null): void {
        entries = entries.slice(0, entryIndex + 1)
        entries.push({ url: targetUrl(url), state: data })
        entryIndex += 1
        syncUrl()
    },
    replaceState(data: unknown, _unused: string, url?: string | URL | null): void {
        entries[entryIndex] = { url: targetUrl(url), state: data }
        syncUrl()
    },
    back(): void {
        if (entryIndex > 0) {
            entryIndex -= 1
            syncUrl()
            testWindow.dispatchEvent(new testWindow.Event("popstate"))
        }
    },
    forward(): void {
        if (entryIndex < entries.length - 1) {
            entryIndex += 1
            syncUrl()
            testWindow.dispatchEvent(new testWindow.Event("popstate"))
        }
    },
}

// Userscript modules register window event listeners (the router's popstate,
// the app's scroll capture, the captcha's message). linkedom's window is a
// proxy over Node's globalThis whose event methods are served by an internal
// EventTarget, so they cannot be redefined on the proxy (a defineProperty
// falls through to globalThis). Instead, the testWindow exported below is a
// thin recording proxy: every addEventListener is noted in a registry before
// being delegated to the real one, and clearWindowListeners removes the noted
// listeners through the real removeEventListener, which does work. The drop
// matters for multi-graph tests (vi.resetModules per test): they keep this
// window but discard the module graph, and a discarded graph's popstate
// listener would otherwise still fire on every back/forward, double-fetching
// through the shared mocked network. Single-graph suites (scroll.test.ts)
// never call it, so their once-registered listeners survive resetDom.
type WindowListener = { type: string; listener: EventListener }
const windowListeners: WindowListener[] = []

const rawAddEventListener = rawWindow.addEventListener.bind(rawWindow)
const rawRemoveEventListener = rawWindow.removeEventListener.bind(rawWindow)

export const testWindow = new Proxy(rawWindow, {
    get(target, prop, receiver) {
        if (prop === "addEventListener") {
            return (
                type: string,
                listener: EventListenerOrEventListenerObject | null,
                options?: boolean | AddEventListenerOptions,
            ): void => {
                if (listener === null) return
                windowListeners.push({
                    type,
                    // The userscript only ever registers plain functions; the
                    // object-listener wrap keeps the registry typed (such
                    // listeners cannot be matched in removeEventListener).
                    listener:
                        typeof listener === "function" ? listener : (e) => listener.handleEvent(e),
                })
                rawAddEventListener(type, listener, options)
            }
        }
        return Reflect.get(target, prop, receiver)
    },
})

export function clearWindowListeners(): void {
    for (const { type, listener } of windowListeners.splice(0)) {
        rawRemoveEventListener(type, listener)
    }
}

Object.defineProperties(testWindow, {
    history: { configurable: true, value: testHistory },
    location: {
        configurable: true,
        value: {
            get href(): string {
                return currentUrl.href
            },
            get pathname(): string {
                return currentUrl.pathname
            },
            get search(): string {
                return currentUrl.search
            },
            get origin(): string {
                return currentUrl.origin
            },
        },
    },
    // The app scrolls the window (state/scroll.ts, App.ts); the fake records
    // the offset so tests can assert on it and feed it back via scrollY.
    scrollTo: {
        configurable: true,
        value: (x: number | ScrollToOptions, y?: number) => {
            testScrollY = typeof x === "object" && x !== null ? (x.top ?? 0) : (y ?? 0)
        },
    },
    scrollY: { configurable: true, get: () => testScrollY },
})

// Tests reset the DOM before importing the modules under test; these are the
// hooks the modules (and the tests) use afterwards.
export function resetDom(url: string = initialUrl): void {
    currentUrl = new URL(url, initialUrl)
    entries = [{ url: currentUrl, state: null }]
    entryIndex = 0
    testScrollY = 0
    parsed.document.head.replaceChildren()
    parsed.document.body.replaceChildren()
    parsed.document.cookie = ""
    localStorage.clear()
}

export function setTestUrl(url: string): void {
    currentUrl = new URL(url, initialUrl)
    entries[entryIndex] = { url: currentUrl, state: entries[entryIndex].state }
}

export function setTestScrollY(y: number): void {
    testScrollY = y
}

// Push an entry through the raw history, bypassing whatever the modules under
// test wrapped — no scroll token in its state — the way an unrelated
// script's pushState would have arrived.
export function pushForeignEntry(url: string, state: unknown = null): void {
    entries = entries.slice(0, entryIndex + 1)
    entries.push({ url: new URL(url, entries[entryIndex].url), state })
    entryIndex += 1
    syncUrl()
}

// Rewrite an entry's history.state directly (e.g. to drop the scroll token).
export function setEntryState(index: number, state: unknown): void {
    entries[index].state = state
}

// Let a macrotask turn, so any van update pass scheduled by the state
// writes before it has run.
export async function flushVan(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
}

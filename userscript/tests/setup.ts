import { testWindow } from "./dom.ts"

class TestResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}

const storage = new Map<string, string>()
const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
        return storage.size
    },
}

// vanjs wraps a live binding that returns a non-node (e.g. a string label)
// with `new Text(...)`. linkedom's Text facade refuses direct construction,
// so the global is a factory: a constructor that returns an object yields
// that object, so `new Text(s)` produces a real node. A plain function
// declaration on purpose — object-method shorthands in this environment are
// not constructible.
function TestText(data: string) {
    return testWindow.document.createTextNode(String(data))
}

const globals = {
    window: testWindow,
    document: testWindow.document,
    location: testWindow.location,
    history: testWindow.history,
    localStorage,
    Node: testWindow.Node,
    Text: TestText,
    Element: testWindow.Element,
    HTMLElement: testWindow.HTMLElement,
    HTMLAnchorElement: testWindow.HTMLAnchorElement,
    HTMLImageElement: testWindow.HTMLImageElement,
    HTMLInputElement: testWindow.HTMLInputElement,
    HTMLTextAreaElement: testWindow.HTMLTextAreaElement,
    HTMLVideoElement: testWindow.HTMLVideoElement,
    DOMParser: testWindow.DOMParser,
    Event: testWindow.Event,
    CustomEvent: testWindow.CustomEvent,
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(callback, 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    addEventListener: testWindow.addEventListener.bind(testWindow),
    removeEventListener: testWindow.removeEventListener.bind(testWindow),
    dispatchEvent: testWindow.dispatchEvent.bind(testWindow),
}

for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
}

if (testWindow.HTMLImageElement && !testWindow.HTMLImageElement.prototype.decode) {
    testWindow.HTMLImageElement.prototype.decode = () => Promise.resolve()
}

if (!testWindow.Element.prototype.scrollIntoView) {
    testWindow.Element.prototype.scrollIntoView = () => undefined
}

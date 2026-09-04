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

const globals = {
    window: testWindow,
    document: testWindow.document,
    location: testWindow.location,
    history: testWindow.history,
    localStorage,
    Node: testWindow.Node,
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

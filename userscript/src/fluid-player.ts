type FluidPlayer = (...args: unknown[]) => unknown

// Rule34 initializes Fluid Player before Arueshalae can replace the page. This
// function is serialized into a page-owned script because
// quoid/userscripts does not expose the page realm as `unsafeWindow`.
export function installRule34PlayerSuppression(pageWindow: Window): void {
    let fluidPlayer: FluidPlayer | undefined
    const inertPlayer = new Proxy(
        {},
        {
            get: () => () => undefined,
        },
    )

    Object.defineProperty(pageWindow, "fluidPlayer", {
        configurable: true,
        get() {
            return function (this: unknown, ...args: unknown[]) {
                if (args[0] === "gelcomVideoPlayer") return inertPlayer
                return fluidPlayer?.apply(this, args)
            }
        },
        set(value: FluidPlayer) {
            fluidPlayer = value
        },
    })
}

export function suppressRule34Player(DOM: Document = document): void {
    const script = DOM.createElement("script")
    script.textContent = `(${installRule34PlayerSuppression.toString()})(window)`
    const parent = DOM.head ?? DOM.documentElement
    parent.append(script)
    script.remove()
}

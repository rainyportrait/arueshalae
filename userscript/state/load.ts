import type { State } from "vanjs-core"

// The shared shape of an async-loaded piece of state: loading, error, or
// ready carrying `T`'s fields spread in. `Extra` admits additional statuses —
// the user profile state adds "idle" while not authenticated.
export type Loadable<T, Extra = never> =
    { status: "loading" } | { status: "error"; error: string } | ({ status: "ready" } & T) | Extra

// Wrap a fetch in a state update with out-of-order protection: every call
// bumps a sequence counter and only the latest call's result is applied.
// Returns the load function, which takes the fetcher's argument.
export function createLoader<T, A, Extra = never>(
    state: State<Loadable<T, Extra>>,
    fetcher: (arg: A) => Promise<T>,
): (arg: A) => void {
    let seq = 0
    return (arg: A) => {
        const current = ++seq
        state.val = { status: "loading" }
        void fetcher(arg).then(
            (data) => {
                if (current !== seq) return
                state.val = { status: "ready", ...data }
            },
            (error: unknown) => {
                if (current !== seq) return
                state.val = { status: "error", error: errorMessage(error) }
            },
        )
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

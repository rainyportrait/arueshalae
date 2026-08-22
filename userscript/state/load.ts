import van from "vanjs-core"
import type { State } from "vanjs-core"

// The shared shape of an async-loaded piece of state: loading, error, or
// ready carrying `T`'s fields spread in. "loading" only holds the initial
// value before the first fetch settles — while a fetch is in flight the state
// keeps its previous value (createLoader doesn't touch it on load start), so
// the page on screen never changes until new data arrives. `Extra` admits
// additional statuses — the user profile state adds "idle" while not
// authenticated.
export type Loadable<T, Extra = never> =
    { status: "loading" } | { status: "error"; error: string } | ({ status: "ready" } & T) | Extra

// Wrap a fetch in a state update with out-of-order protection: every call
// bumps a sequence counter and only the latest call's result is applied.
// Returns the load function (which takes the fetcher's argument) and a
// `pending` state that is true while a fetch is in flight. The data state is
// deliberately not changed on load start — the pending state is what the
// loading bar reads, so a load can begin without re-rendering the page.
export function createLoader<T, A, Extra = never>(
    state: State<Loadable<T, Extra>>,
    fetcher: (arg: A) => Promise<T>,
): { load: (arg: A) => void; pending: State<boolean> } {
    let seq = 0
    const pending = van.state(false)
    const load = (arg: A) => {
        const current = ++seq
        pending.val = true
        void fetcher(arg).then(
            (data) => {
                if (current !== seq) return
                pending.val = false
                state.val = { status: "ready", ...data }
            },
            (error: unknown) => {
                if (current !== seq) return
                pending.val = false
                state.val = { status: "error", error: errorMessage(error) }
            },
        )
    }
    return { load, pending }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

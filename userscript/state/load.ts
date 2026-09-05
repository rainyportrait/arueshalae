import van from "vanjs-core"
import type { State } from "vanjs-core"

import { isChallengePage } from "../captcha.ts"
import { type Route, route } from "../router.ts"

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

type RouteOfType<K extends Route["type"]> = Extract<Route, { type: K }>

// The standard shape of a page's data state, wired up in one call: a loader
// whose trigger derive watches the route (plus a reload tick) and fetches
// only while the route is of the given type (no wasted fetch on other
// routes). Returns a `pending` state for the loading bar and a `reload`
// function for the error state's "Try again" button.
//
// The fetcher receives the guarded route, so it reads its arguments from the
// same navigation that triggered it — no derived-state reads that could make
// the trigger derive depend on anything but `route` and the reload tick.
// As everywhere else, the data state is not touched on load start; it keeps
// the previous page until the fetch settles.
//
// `seed` (optional) shortcuts the first evaluation only, which runs
// synchronously at registration — while the live document is still the
// server's rendering of the initial URL (the app wipes it in initApp).
// When that route is this page's type, the seed parses the document and the
// state settles without re-fetching the URL the browser just loaded.
// Returning `null` signals that the document doesn't carry this page (the
// bare site root serves a landing page for the canonical home route) and
// the state loads from the network as usual. The seed is skipped on a
// challenge page (whose body is not this page) and a throwing seed (markup
// we didn't expect) also falls back to the network load.
export function routeLoader<T, K extends Route["type"]>(
    state: State<Loadable<T>>,
    routeType: K,
    fetcher: (route: RouteOfType<K>) => Promise<T>,
    seed?: (route: RouteOfType<K>) => T | null,
): { pending: State<boolean>; reload: () => void } {
    const tick = van.state(0)
    const { load, pending } = createLoader<T, RouteOfType<K>>(state, fetcher)
    // The first evaluation runs at registration, while `route` still holds
    // the initial route: the only moment the seed is valid. The flag is
    // consumed on every evaluation (including type misses) so a later
    // navigation to this type always fetches.
    let firstEvaluation = true
    // Reading `tick` via `void` registers it as a dependency without using
    // its value, so bumping the tick re-runs this derive (a forced reload)
    // just like a route change does.
    van.derive(() => {
        const isFirst = firstEvaluation
        firstEvaluation = false
        const r = route.val
        if (r.type !== routeType) return
        void tick.val
        if (isFirst && seed !== undefined && !isChallengePage()) {
            try {
                const data = seed(r as RouteOfType<K>)
                if (data !== null) {
                    state.val = { status: "ready", ...data }
                    return
                }
                // The document doesn't carry this page: load from the
                // network.
            } catch {
                // Markup the seed doesn't recognize: fall through to the
                // network load.
            }
        }
        load(r as RouteOfType<K>)
    })
    return {
        pending,
        reload: () => {
            tick.val += 1
        },
    }
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

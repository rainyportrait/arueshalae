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
// Returns the load function (which takes the fetcher's argument), a `pending`
// state that is true while a fetch is in flight, and `cancel`, which discards
// an in-flight fetch without starting a new one (an instant navigation — a
// replay hit — must not be clobbered by the fetch it superseded). The data
// state is deliberately not changed on load start — the pending state is what
// the loading bar reads, so a load can begin without re-rendering the page.
//
// `onSettle` decides what a successful settle publishes: a payload to write
// (possibly different from the fetched one) or false to keep the previous
// payload on screen (the fetch revalidated but changed nothing). The error
// path publishes as usual; `onPublish` sees every value written to the state
// so a caller that tracks which payload the screen shows stays in sync with
// the error path too.
export function createLoader<T, A, Extra = never>(
    state: State<Loadable<T, Extra>>,
    fetcher: (arg: A) => Promise<T>,
    onSettle?: (data: T, arg: A) => T | false,
    onPublish?: (value: Loadable<T, Extra>) => void,
): { load: (arg: A) => void; pending: State<boolean>; cancel: () => void } {
    let seq = 0
    const pending = van.state(false)
    const publish = (value: Loadable<T, Extra>) => {
        state.val = value
        onPublish?.(value)
    }
    const load = (arg: A) => {
        const current = ++seq
        pending.val = true
        void fetcher(arg).then(
            (data) => {
                if (current !== seq) return
                pending.val = false
                const published = onSettle === undefined ? data : onSettle(data, arg)
                if (published !== false) publish({ status: "ready", ...(published ?? data) })
            },
            (error: unknown) => {
                if (current !== seq) return
                pending.val = false
                publish({ status: "error", error: errorMessage(error) })
            },
        )
    }
    const cancel = () => {
        seq += 1
        pending.val = false
    }
    return { load, pending, cancel }
}

type RouteOfType<K extends Route["type"]> = Extract<Route, { type: K }>

// A replay source: recently loaded payloads keyed by route, letting a
// navigation render the stale context instantly — the screen flips to the
// cached page in the same pass as the route change (so the scroll memory can
// restore an offset without waiting for a fetch) — while a stale entry
// revalidates in the background. The source is plain storage (no van state),
// so the trigger derive below depends on nothing but the route and the
// reload tick.
export type Replay<T, K extends Route["type"]> = {
    // Distinct keys are distinct contexts (a different pid or query is a
    // different page, even of the same route type).
    key: (r: RouteOfType<K>) => string
    get: (key: string) => { data: T; at: number } | undefined
    set: (key: string, data: T) => void
    // A cached payload younger than this (ms) is replayed without a refetch;
    // older ones replay too, but also revalidate in the background.
    freshFor: number
    // A background revalidation settles invisibly (no state write, no
    // re-render) when its payload is "the same" as the one on screen.
    // Without it, every settle re-renders the page (a new object either way).
    same?: (fetched: T, cached: T) => boolean
}

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
//
// `replay` (optional) adds instant replay of recently loaded pages: a
// navigation whose route is in the source renders the cached payload in the
// same pass (the state shows the route's own payload, so the screen can flip
// immediately) instead of holding the previous page until a fetch settles.
// An in-flight fetch for another route is cancelled, and a stale entry — or
// a forced reload — revalidates in the background, settling invisibly when
// nothing changed (the source's `same`).
export function routeLoader<T, K extends Route["type"]>(
    state: State<Loadable<T>>,
    routeType: K,
    fetcher: (route: RouteOfType<K>) => Promise<T>,
    seed?: (route: RouteOfType<K>) => T | null,
    replay?: Replay<T, K>,
): { pending: State<boolean>; reload: () => void } {
    const tick = van.state(0)
    // The payload the state currently shows, by reference. Lets a replay hit
    // skip a redundant state write (the screen already shows it) and a
    // revalidation decide whether the on-screen payload is the cached one;
    // an error publish (onPublish) voids it.
    let shownPayload: T | undefined
    const onSettle =
        replay === undefined
            ? undefined
            : (data: T, arg: RouteOfType<K>): T | false => {
                  const key = replay.key(arg)
                  const hit = replay.get(key)
                  const same =
                      hit !== undefined &&
                      (replay.same === undefined || replay.same(data, hit.data))
                  if (same && shownPayload === hit.data) {
                      // The screen already shows the (equivalent) payload:
                      // refresh the entry's freshness and settle invisibly.
                      replay.set(key, hit.data)
                      return false
                  }
                  replay.set(key, data)
                  shownPayload = data
                  return data
              }
    const onPublish =
        replay === undefined
            ? undefined
            : (value: Loadable<T>) => {
                  if (value.status !== "ready") shownPayload = undefined
              }
    const { load, pending, cancel } = createLoader<T, RouteOfType<K>>(
        state,
        fetcher,
        onSettle,
        onPublish,
    )
    // The first evaluation runs at registration, while `route` still holds
    // the initial route: the only moment the seed is valid. The flag is
    // consumed on every evaluation (including type misses) so a later
    // navigation to this type always fetches.
    let firstEvaluation = true
    let lastTick = 0
    van.derive(() => {
        const isFirst = firstEvaluation
        firstEvaluation = false
        const r = route.val
        if (r.type !== routeType) return
        // A forced reload (the tick moved) bypasses the replay freshness
        // check: refresh must fetch even for a fresh page.
        const forced = tick.val !== lastTick
        lastTick = tick.val
        if (isFirst && seed !== undefined && !isChallengePage()) {
            try {
                const data = seed(r as RouteOfType<K>)
                if (data !== null) {
                    state.val = { status: "ready", ...data }
                    shownPayload = data
                    if (replay !== undefined) replay.set(replay.key(r as RouteOfType<K>), data)
                    return
                }
                // The document doesn't carry this page: load from the
                // network.
            } catch {
                // Markup the seed doesn't recognize: fall through to the
                // network load.
            }
        }
        // A replay hit renders the stale context instantly: the state shows
        // this route's own payload (if it doesn't already), so the screen
        // can flip to it in this same pass — no loading state, no held-over
        // page.
        if (replay !== undefined) {
            const key = replay.key(r as RouteOfType<K>)
            const hit = replay.get(key)
            if (hit !== undefined) {
                cancel()
                if (shownPayload !== hit.data) {
                    state.val = { status: "ready", ...hit.data }
                    shownPayload = hit.data
                }
                if (forced || Date.now() - hit.at >= replay.freshFor) load(r as RouteOfType<K>)
                return
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

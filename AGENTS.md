# arueshalae

A userscript that replaces the default rule34.xxx UI with a custom Van.js UI.

Built with TypeScript, [van.js](https://vanjs.org/) (`vanjs-core`), and Tailwind CSS v4.

The source files can be found in `./userscript/`.

## Build & dev loop

- `node build-userscript.ts` to build the userscript end to end with tailwindcss and esbuild.
- The script runs at `document-end` and declares `@grant GM.xmlHttpRequest`.

## Verification

- There is no automated UI check (it's a userscript injected into a live site); the user is the eyes
  for visual design.
- Parsing/extraction logic can be verified against the sample HTML in `examples/*.html` (gitignored)
  with a DOM parser.
- Standard green checks: `pnpm exec tsc --noEmit`, `just build-userscript`,
  `pnpm exec prettier --check .`.
- **esbuild does not type-check.** Run `pnpx tsc --noEmit` to verify types.

## Commit messages

- Conventional-commit type prefix without a scope: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`,
  `style:`.
- Subject line: imperative, lowercase, no trailing period. Describe the change as a whole, not the
  mechanics ("add the favorites page, reusing the post grid and pagination").
- Small changes: subject line only.
- Larger changes: a prose body explaining the _why_ and how it works, followed by a bullet list of
  the touched files as `- path: what changed` (see the authentication commit for the shape).

## van.js patterns

- `van.derive(f)` runs `f` immediately, stores its return value in `.val`, and re-runs `f` when any
  state read inside `f` changes. The generic is inferred from the callback's return, so pass an
  explicit one (e.g. `van.derive<number>(...)`) when the inferred type is too wide.
- Page data lives in `van.state` values typed `Loadable<T>` (`state/load.ts`), fetched by a
  **trigger derive** that watches `route` and calls the `createLoader` fetcher as a side effect (see
  `state/list.ts`). A trigger derive watches only `route` (and a reload tick) — derived values like
  `tags` are read via `rawVal` inside the fetcher, or the derive would re-run (and re-fetch) a
  second time when they change alongside the route. The data state is **not** touched on load start
  — it keeps the previous page until the fetch settles, so a navigation never re-renders the page
  mid-flight. Each loader exposes a `pending` state, and the loading bar (`state/loading.ts`) is
  derived from those. The visible page follows `shownType` (App.ts), which lags behind `route` until
  the target page's fetch settles: a cross-page navigation keeps the old screen (and swaps to the
  new one only when it is ready or errored), so a page never shows stale content.
- vanjs prop types do **not** accept `undefined`; pass concrete defaults instead of optional
  `undefined`.
- `van.add(dom, ...children)` accepts arrays (`ChildDom[]`).
- A **live node** (a function passed to `van.add` or as a child) must always return a connected DOM
  node, **never `null`**. `bind()` stores the returned node as the binding's `_dom`, and on the next
  state change `updateDoms()` runs `keepConnected`, which drops any binding whose `_dom` isn't
  connected. Returning `null` (e.g. a conditional "nothing to show") leaves `_dom` null, so the
  binding is silently discarded and the node never re-renders. Return a zero-footprint placeholder
  like `document.createComment("")` instead (see `CaptchaModal` in `captcha.ts`).
- vanjs **replaces** any child node whose identity changed between renders — a new element is a
  swap, not a diff. Returning a fresh node from a live function that re-runs (e.g. calling
  `PostList()` again on a route change) rebuilds the whole subtree, reloading every `<img>` (a
  visible flash). Cache the node and return the same object while it stays on screen (see `ArueApp`
  in `App.ts`) — but a node that has been _detached_ must be rebuilt, never reused: vanjs
  permanently drops any binding (and derive listener) whose `_dom` is disconnected when a subscribed
  state changes (`keepConnected` in vanjs-core), so a re-attached subtree is dead and never updates
  again.
- The same trap applies to _reads_: any state read while a plain child function runs registers a
  dependency on the **parent** binding, so e.g. reading `route` in `PostCard` would rebuild the
  whole grid on every navigation. Make the varying bit a live function prop so only the attribute
  updates (see `PostCard`/`Link`).
- There are no lifecycle hooks. To run code after an element exists, attach a native handler (e.g.
  `onload` on an `<img>`; vanjs wires `on*` props via `addEventListener`).

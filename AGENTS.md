# arueshalae

A userscript that replaces the default rule34.xxx UI with a custom Van.js UI.

Built with TypeScript, [van.js](https://vanjs.org/) (`vanjs-core`), and Tailwind CSS v4.

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

## van.js patterns

- `van.derive(f)` runs `f` immediately, stores its return value in `.val`, and re-runs `f` when any
  state read inside `f` changes. For async fetches, return a placeholder and assign the real value
  in `.then` (see `state.ts`). The generic is inferred from the callback's return, so pass an
  explicit one (e.g. `van.derive<PostList | null>(...)`) when the placeholder's type differs.
- vanjs prop types do **not** accept `undefined`; pass concrete defaults instead of optional
  `undefined`.
- `van.add(dom, ...children)` accepts arrays (`ChildDom[]`).
- A **live node** (a function passed to `van.add` or as a child) must always return a connected DOM
  node, **never `null`**. `bind()` stores the returned node as the binding's `_dom`, and on the next
  state change `updateDoms()` runs `keepConnected`, which drops any binding whose `_dom` isn't
  connected. Returning `null` (e.g. a conditional "nothing to show") leaves `_dom` null, so the
  binding is silently discarded and the node never re-renders. Return a zero-footprint placeholder
  like `document.createComment("")` instead (see `CaptchaModal` in `App.ts`).
- There are no lifecycle hooks. To run code after an element exists, attach a native handler (e.g.
  `onload` on an `<img>`; vanjs wires `on*` props via `addEventListener`).

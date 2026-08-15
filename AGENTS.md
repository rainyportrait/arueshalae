# arueshalae

A userscript that replaces the default rule34.xxx UI with a custom Van.js UI.

Built with TypeScript, [van.js](https://github.com/vanjs-org/van) (`vanjs-core`) and Tailwind CSS
v4.

## Build & dev loop

- `node build-userscript.ts` to build the userscript end to end with tailwindcss and esbuild.
- The script runs at `document-end` and declares `@grant GM.xmlHttpRequest`.

## Formatting & type-checking

- Prettier `pnpm format` / `pnpm format:check`.
- **esbuild does not type-check.** Run `pnpx tsc --noEmit` separately to verify types.

## van.js patterns

- `van.derive(f)` runs `f` immediately, stores its return value in `.val`, and re-runs `f` when any
  state read inside `f` changes. For async fetches, return a placeholder and assign the real value
  in `.then` (see `state.ts`). The generic is inferred from the callback's return, so pass an
  explicit one (e.g. `van.derive<PostList | null>(...)`) when the placeholder's type differs.
- vanjs prop types do **not** accept `undefined`; pass concrete defaults instead of optional
  `undefined`.
- `van.add(dom, ...children)` accepts arrays (`ChildDom[]`).
- There are no lifecycle hooks. To run code after an element exists, attach a native handler (e.g.
  `onload` on an `<img>`; vanjs wires `on*` props via `addEventListener`).

## State & data flow (`userscript/state.ts`)

- A `van.derive` re-fetches whenever `tags`, `pid`, or `reloadTick` changes; a `requestSeq` counter
  discards out-of-order responses.
- `search()`, `reloadList()` are the mutation helpers.
- rule34.xxx paginates 42 posts per page: `pid = 42 * (page - 1)` (`PAGE_SIZE = 42`).

## Verification

- There is no automated UI check (it's a userscript injected into a live site); the user is the eyes
  for visual design.
- Parsing/extraction logic can be verified against the sample HTML in `examples/*.html` (gitignored)
  with a DOM parser.
- Standard green checks: `pnpm exec tsc --noEmit`, `just build-userscript`,
  `pnpm exec prettier --check .`.

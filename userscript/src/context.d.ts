// Injected as a global by the build banner (see build-userscript.ts).
declare var TAILWIND_CSS: string

// vanjs-core ships no `types` field for its package root (only the
// `src/van` subpath has declarations, which Node's exports map blocks), so
// alias the root import to the typed subpath.
declare module "vanjs-core" {
    export * from "vanjs-core/src/van"
    export { default } from "vanjs-core/src/van"
}

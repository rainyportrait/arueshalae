import van from "vanjs-core"
import type { ChildDom, Props } from "vanjs-core"

import { navigate, parseRoute } from "./router.ts"

const { a } = van.tags

// A link that renders a real <a href> (so middle-click, ⌘/Ctrl-click,
// Shift-click and right-click keep their native behavior) but intercepts a
// plain left-click to navigate SPA-style. Unrecognized hrefs are left to the
// browser (no preventDefault), so they do a normal full navigation.
// With replace set, a left-click replaces the current history entry instead
// of pushing one (the gallery's filmstrip uses this).
export function Link(
    props: Props & { href: string; replace?: boolean },
    ...children: readonly ChildDom[]
): HTMLAnchorElement {
    const { href, replace, ...rest } = props
    return a(
        {
            ...rest,
            href,
            onclick: (e: MouseEvent) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                const next = parseRoute(href)
                if (next.type === "unknown") return
                e.preventDefault()
                navigate(next, { replace })
            },
        },
        ...children,
    )
}

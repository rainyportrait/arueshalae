import van from "vanjs-core"
import type { ChildDom } from "vanjs-core"

import clsx from "./clsx.ts"

const { button, div, h2, p, span } = van.tags

type Props = {
    icon: string
    title: string
    message?: string
    // Optional extra content between the message and the action (the route
    // placeholder uses it for its parsed-params box).
    extra?: ChildDom
    action?: { label: string; onclick: () => void }
}

// A centered status view: an icon, a title, an optional message, and an
// optional primary action button. Shared by the post list and post details
// error/empty states, the 404 page, and the route placeholder.
export function CenteredState({ icon, title, message, extra, action }: Props): HTMLDivElement {
    return div(
        { class: "flex flex-col items-center justify-center gap-2 py-24 text-center" },
        span({ class: "text-4xl" }, icon),
        h2({ class: "mt-2 text-lg font-medium text-zinc-200" }, title),
        message ? p({ class: "max-w-md px-4 text-sm text-zinc-500" }, message) : null,
        extra ?? null,
        action
            ? button(
                  {
                      class: clsx(
                          "mt-3 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                          "transition-colors hover:bg-rose-400",
                      ),
                      onclick: action.onclick,
                  },
                  action.label,
              )
            : null,
    )
}

import van from "vanjs-core"

import clsx from "./clsx.ts"

const { button, div, h2, p, span } = van.tags

type Props = {
    icon: string
    title: string
    message?: string
    action?: { label: string; onclick: () => void }
}

// A centered status view: an icon, a title, an optional message, and an
// optional primary action button. Shared by the post list and post details
// error/empty states, the 404 page, and the route placeholder.
export function CenteredState({ icon, title, message, action }: Props): HTMLDivElement {
    return div(
        { class: clsx("flex flex-col items-center justify-center gap-2 py-24 text-center") },
        span({ class: clsx("text-4xl") }, icon),
        h2({ class: clsx("mt-2 text-lg font-medium text-zinc-200") }, title),
        message ? p({ class: clsx("max-w-md px-4 text-sm text-zinc-500") }, message) : null,
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

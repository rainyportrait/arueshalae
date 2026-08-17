import van from "vanjs-core"
import type { State } from "vanjs-core"

import clsx from "./clsx.ts"

const { button, div, p, span } = van.tags

// A labelled on/off switch. Reads its state through function props so it stays
// in sync reactively; the caller owns the state and the setter.
export function Toggle({
    label,
    description,
    state,
    onToggle,
}: {
    label: string
    description: string
    state: State<boolean>
    onToggle: (value: boolean) => void
}) {
    return div(
        { class: clsx("flex items-center justify-between gap-4") },
        div(
            { class: clsx("min-w-0") },
            div({ class: clsx("text-sm font-medium text-zinc-100") }, label),
            p({ class: clsx("mt-0.5 text-sm text-zinc-500") }, description),
        ),
        button(
            {
                type: "button",
                role: "switch",
                "aria-checked": () => state.val,
                class: () =>
                    clsx(
                        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                        state.val ? "bg-rose-500" : "bg-zinc-700",
                    ),
                onclick: () => onToggle(!state.val),
            },
            span({
                class: () =>
                    clsx(
                        "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                        state.val ? "left-[22px]" : "left-0.5",
                    ),
            }),
        ),
    )
}

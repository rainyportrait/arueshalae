import van from "vanjs-core/src/van"

import { Link } from "./Link"
import clsx from "./clsx"
import { search, tags } from "./state"

const { button, div, form, input, nav, span } = van.tags

export function Navbar() {
    return nav(
        {
            class: clsx(
                "sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur",
            ),
        },
        div(
            { class: "mx-auto flex w-full max-w-[2000px] items-center gap-3 px-4 py-3" },
            Link(
                {
                    href: "/index.php?page=post&s=list",
                    class: "flex shrink-0 items-center gap-2",
                    "aria-label": "Arueshalae home",
                },
                span({ class: "text-sm leading-none text-rose-500" }, "◆"),
                span({ class: "text-lg font-semibold tracking-tight text-zinc-100" }, "Arueshalae"),
            ),
            form(
                {
                    class: "flex min-w-0 flex-1 items-center gap-2",
                    role: "search",
                    onsubmit: (e: SubmitEvent) => {
                        e.preventDefault()
                        const raw = (e.target as HTMLFormElement).tagQuery.value.trim()
                        search(raw === "" ? undefined : raw)
                    },
                },
                div(
                    { class: "relative min-w-0 flex-1" },
                    span({
                        "icon-name": "search",
                        class: "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-zinc-500",
                        "aria-hidden": "true",
                    }),
                    input({
                        name: "tagQuery",
                        type: "text",
                        placeholder: "Search using tags (e.g. blonde_hair)",
                        value: () => tags.val ?? "",
                        "aria-label": "Search using tags",
                        class: clsx(
                            "w-full rounded-lg border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3",
                            "text-sm text-zinc-100 placeholder:text-zinc-500",
                            "transition-colors focus:border-rose-500/60 focus:outline-none",
                            "focus:ring-2 focus:ring-rose-500/20",
                        ),
                    }),
                ),
                button(
                    {
                        type: "submit",
                        class: clsx(
                            "shrink-0 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                            "transition-colors hover:bg-rose-400",
                        ),
                    },
                    "Search",
                ),
            ),
        ),
    )
}

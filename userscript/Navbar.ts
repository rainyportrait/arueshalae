import van from "vanjs-core/src/van"

import { Link } from "./Link"
import { SearchBar } from "./SearchBar"
import clsx from "./clsx"

const { div, nav, span } = van.tags

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
            SearchBar(),
        ),
    )
}

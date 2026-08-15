import van from "vanjs-core/src/van"

import { Navbar } from "./Navbar"
import { PostList } from "./PostList"

const { div, footer, main, meta, style, title } = van.tags

function ArueApp() {
    return div(
        { class: "flex min-h-screen flex-col bg-zinc-950 text-zinc-100" },
        Navbar(),
        main({ class: "mx-auto w-full max-w-[2000px] flex-1 px-4 py-6" }, PostList()),
        footer(
            { class: "border-t border-zinc-900 py-4 text-center text-xs text-zinc-600" },
            "Arueshalae",
        ),
    )
}

function ArueHead() {
    return [
        title("Rule34.xxx - Arueshalae"),
        style(TAILWIND_CSS),
        meta({ name: "viewport", content: "width=device-width, initial-scale=1.0" }),
    ]
}

export function initApp() {
    document.head.innerHTML = ""
    van.add(document.head, ArueHead())

    document.body.innerHTML = ""
    van.add(document.body, ArueApp())
}

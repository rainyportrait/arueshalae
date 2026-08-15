import van from "vanjs-core"

import { Navbar } from "./Navbar"
import { PostList } from "./PostList"

const { title, style, meta, div } = van.tags

function ArueApp() {
    return div(Navbar(), PostList())
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

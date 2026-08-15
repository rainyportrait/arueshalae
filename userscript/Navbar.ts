import van from "vanjs-core/src/van"

import { tags } from "./state"

const { nav, span, form, input, button } = van.tags

export function Navbar() {
    return nav(
        span("Arueshalae"),
        form(
            {
                onsubmit: (e: SubmitEvent) => {
                    e.preventDefault()
                    tags.val = (e.target as HTMLFormElement).tagQuery.value
                },
            },
            input({
                name: "tagQuery",
                type: "text",
                placeholder: "Search using tags (i.e. blonde_hair)",
            }),
            button("Search"),
        ),
    )
}

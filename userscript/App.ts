import van from "vanjs-core"

import { Login } from "./Login.ts"
import { Navbar } from "./Navbar.ts"
import { NotFound, RoutePlaceholder } from "./Placeholders.ts"
import { PostDetails } from "./PostDetails.ts"
import { PostList } from "./PostList.ts"
import { CaptchaModal } from "./captcha.ts"
import { route } from "./router.ts"

const { div, main } = van.tags

function ArueApp() {
    return div(
        { class: "flex min-h-screen flex-col bg-zinc-950 text-zinc-100" },
        Navbar(),
        main({ class: "mx-auto w-full max-w-[2000px] flex-1 px-4 py-6" }, () => {
            const r = route.val
            switch (r.type) {
                case "postlist":
                    return PostList()
                case "postdetails":
                    return PostDetails()
                case "login":
                    return Login()
                case "account":
                case "favorites":
                case "settings":
                    return RoutePlaceholder(r)
                case "unknown":
                    return NotFound()
            }
        }),
    )
}

export function initApp(): void {
    document.body.innerHTML = ""
    van.add(document.body, ArueApp())
    van.add(document.body, CaptchaModal())
}

import van from "vanjs-core"

import { Account } from "./Account.ts"
import { Favorites } from "./Favorites.ts"
import { Login } from "./Login.ts"
import { Navbar } from "./Navbar.ts"
import { NotFound } from "./Placeholders.ts"
import { PostDetails } from "./PostDetails.ts"
import { PostList } from "./PostList.ts"
import { Settings } from "./Settings.ts"
import { CaptchaModal } from "./captcha.ts"
import clsx from "./clsx.ts"
import { route } from "./router.ts"

const { div, main } = van.tags

function ArueApp() {
    return div(
        { class: clsx("flex min-h-screen flex-col bg-zinc-950 text-zinc-100") },
        Navbar(),
        main({ class: clsx("mx-auto w-full flex-1 px-4 py-6") }, () => {
            const r = route.val
            switch (r.type) {
                case "postlist":
                    return PostList()
                case "postdetails":
                    return PostDetails()
                case "login":
                    return Login()
                case "favorites":
                    return Favorites()
                case "account":
                    return Account()
                case "settings":
                    return Settings()
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

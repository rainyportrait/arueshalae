import van from "vanjs-core/src/van"
import type { ChildDom } from "vanjs-core/src/van"

import { Link } from "./Link"
import { SearchBar } from "./SearchBar"
import clsx from "./clsx"
import { route, routeToUrl } from "./router"
import { auth, logout, userInfo } from "./state"

const { button, div, nav, span } = van.tags

const MENU_ITEM_CLASS = clsx(
    "block w-full px-3 py-2 text-left text-sm text-zinc-200",
    "hover:bg-zinc-800/60 focus:bg-zinc-800/60 focus:outline-none",
)

// A click-to-toggle user menu (no hover). Clicking the trigger opens it,
// clicking the trigger again or clicking outside closes it, with basic keyboard
// handling: focusable trigger, ArrowDown opens and enters the menu, arrows move
// within it, Enter activates the focused item, Escape closes and refocuses the
// trigger.
function UserMenu(): HTMLDivElement {
    const open = van.state(false)
    let container: HTMLDivElement
    let trigger: HTMLButtonElement

    function closeAndRefocus(): void {
        open.val = false
        trigger?.focus()
    }

    function focusFirstItem(): void {
        // The menu renders in a microtask after `open` flips, so defer the
        // focus to the next frame once it is in the DOM.
        requestAnimationFrame(() => {
            container.querySelector<HTMLElement>("[role=menuitem]")?.focus()
        })
    }

    // Close when clicking anywhere outside the menu.
    document.addEventListener("click", (e) => {
        if (!open.val) return
        if (container && !container.contains(e.target as Node)) open.val = false
    })

    // Escape closes (and refocuses the trigger); arrows move focus among the
    // menu's items, but only while focus is already inside the menu.
    document.addEventListener("keydown", (e) => {
        if (!open.val) return
        if (e.key === "Escape") {
            e.preventDefault()
            closeAndRefocus()
            return
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
        if (!container.contains(document.activeElement)) return
        const items = [...container.querySelectorAll<HTMLElement>("[role=menuitem]")]
        if (items.length === 0) return
        const idx = items.indexOf(document.activeElement as HTMLElement)
        const next =
            e.key === "ArrowDown"
                ? (idx + 1) % items.length
                : (idx - 1 + items.length) % items.length
        e.preventDefault()
        items[next]?.focus()
    })

    // Close whenever the route changes (a menu link navigates, or the user
    // goes back/forward). Depends only on `route`: reading `open` here would
    // make the derive re-run on open/close and immediately re-close it. Setting
    // `open` to false is a no-op when it is already closed, so this is safe.
    van.derive(() => {
        void route.val
        open.val = false
    })

    trigger = button(
        {
            type: "button",
            class: () =>
                clsx(
                    "flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5",
                    "text-sm text-zinc-200 transition-colors",
                    auth.val.status === "unknown"
                        ? "cursor-default opacity-60"
                        : "hover:bg-zinc-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40",
                ),
            "aria-haspopup": "menu",
            "aria-expanded": () => open.val,
            disabled: () => auth.val.status === "unknown",
            onclick: () => {
                if (auth.val.status === "unknown") return
                open.val = !open.val
            },
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "ArrowDown") {
                    e.preventDefault()
                    open.val = true
                    focusFirstItem()
                }
            },
        },
        span({ "icon-name": "user", class: "text-lg text-zinc-400" }),
        // The username appears only when the profile is ready, so the trigger
        // doesn't grow/shrink as the name arrives (just the icon meanwhile).
        () => {
            const ui = userInfo.val
            return ui.status === "ready"
                ? span({ class: "max-w-40 truncate" }, ui.profile.username)
                : document.createComment("")
        },
    )

    const menu = (): Node => {
        if (!open.val) return document.createComment("")
        const a = auth.val
        if (a.status === "unknown") return document.createComment("")

        const items: ChildDom[] = []
        if (a.status === "guest") {
            items.push(
                Link(
                    {
                        href: routeToUrl({ type: "login" }),
                        role: "menuitem",
                        class: MENU_ITEM_CLASS,
                    },
                    "Login",
                ),
                Link(
                    {
                        href: routeToUrl({ type: "settings" }),
                        role: "menuitem",
                        class: MENU_ITEM_CLASS,
                    },
                    "Settings",
                ),
            )
        } else {
            items.push(
                Link(
                    {
                        href: routeToUrl({ type: "account", id: a.userId }),
                        role: "menuitem",
                        class: MENU_ITEM_CLASS,
                    },
                    "Profile",
                ),
                Link(
                    {
                        href: routeToUrl({ type: "favorites", id: a.userId }),
                        role: "menuitem",
                        class: MENU_ITEM_CLASS,
                    },
                    favoritesLabel(),
                ),
                Link(
                    {
                        href: routeToUrl({ type: "settings" }),
                        role: "menuitem",
                        class: MENU_ITEM_CLASS,
                    },
                    "Settings",
                ),
                // A divider visually sets Logout apart from the navigation items.
                div({ role: "separator", class: "my-1 border-t border-zinc-800" }),
                button(
                    {
                        type: "button",
                        role: "menuitem",
                        class: MENU_ITEM_CLASS,
                        onclick: () => {
                            open.val = false
                            logout()
                        },
                    },
                    "Logout",
                ),
            )
        }

        return div(
            {
                role: "menu",
                class: clsx(
                    "absolute right-0 top-full z-50 mt-2 min-w-44",
                    "rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-lg",
                ),
            },
            items,
        )
    }

    // The "Favorites" menu item shows the count once the profile is ready, and
    // just the bare word while loading or on error.
    function favoritesLabel(): string {
        const ui = userInfo.val
        return ui.status === "ready" ? `Favorites (${ui.profile.favorites})` : "Favorites"
    }

    container = div({ class: "relative flex items-center" }, trigger, menu)
    return container
}

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
            UserMenu(),
        ),
    )
}

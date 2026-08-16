import van from "vanjs-core"

import clsx from "./clsx.ts"
import { login } from "./state/auth.ts"

const { button, div, form, h1, input, label, p, span } = van.tags

const FIELD_CLASS = clsx(
    "w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2",
    "text-sm text-zinc-100 placeholder:text-zinc-500",
    "transition-colors focus:border-rose-500/60 focus:outline-none",
    "focus:ring-2 focus:ring-rose-500/20",
)

// The login page is a real SPA route (not a link to the site's native form).
// A plain username + password form; on submit we POST to the site's login
// endpoint and either navigate back (success) or show the error (failure).
export function Login() {
    const submitting = van.state(false)
    const error = van.state<string | null>(null)

    const usernameEl = input({
        type: "text",
        name: "user",
        autocomplete: "username",
        placeholder: "Username",
        "aria-label": "Username",
        class: FIELD_CLASS,
        oninput: () => {
            error.val = null
        },
    })
    const passwordEl = input({
        type: "password",
        name: "pass",
        autocomplete: "current-password",
        placeholder: "Password",
        "aria-label": "Password",
        class: FIELD_CLASS,
        oninput: () => {
            error.val = null
        },
    })

    return div(
        { class: "mx-auto w-full max-w-sm py-16" },
        div(
            { class: "mb-8" },
            div(
                { class: "flex items-center gap-2.5" },
                span({ class: "text-2xl leading-none text-rose-500" }, "\u25C6"),
                h1({ class: "text-3xl font-semibold tracking-tight text-zinc-100" }, "Login"),
            ),
            p({ class: "mt-2 text-sm text-zinc-400" }, "Sign in to your Rule34.xxx account."),
        ),
        form(
            {
                class: "flex flex-col gap-4",
                onsubmit: async (e: SubmitEvent) => {
                    e.preventDefault()
                    if (submitting.val) return // guard against double-submits
                    const user = usernameEl.value.trim()
                    const pass = passwordEl.value
                    if (user === "" || pass === "") {
                        error.val = "Enter your username and password."
                        return
                    }
                    error.val = null
                    submitting.val = true
                    try {
                        const result = await login(user, pass)
                        // On success `login` navigated us away (this page
                        // unmounts); only a failure needs the in-flight state
                        // cleared and the error shown.
                        if (!result.ok) {
                            error.val = result.error
                            submitting.val = false
                        }
                    } catch (err) {
                        error.val = err instanceof Error ? err.message : "Login failed."
                        submitting.val = false
                    }
                },
            },
            div(
                { class: "flex flex-col gap-1.5" },
                label({ class: "text-sm text-zinc-300" }, "Username"),
                usernameEl,
            ),
            div(
                { class: "flex flex-col gap-1.5" },
                label({ class: "text-sm text-zinc-300" }, "Password"),
                passwordEl,
            ),
            // The error slot: a live node that must always return a connected
            // node (van.js drops a binding whose node is null), so an empty
            // comment when there is no error.
            () =>
                error.val
                    ? p({ class: "text-sm text-red-400" }, error.val)
                    : document.createComment(""),
            button(
                {
                    type: "submit",
                    class: clsx(
                        "rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                        "transition-colors hover:bg-rose-400",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                    ),
                    disabled: () => submitting.val,
                },
                () => (submitting.val ? "Logging in…" : "Log in"),
            ),
        ),
    )
}

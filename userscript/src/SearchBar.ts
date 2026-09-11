import van from "vanjs-core"

import { AutocompleteInput } from "./AutocompleteInput.ts"
import { fetchAutocomplete, fetchFavoriteAutocomplete } from "./api/autocomplete.ts"
import { normalizeTags } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { navigate, route } from "./router.ts"
import { auth } from "./state/auth.ts"
import { search } from "./state/list.ts"
import { registerSearchField } from "./state/search-field.ts"
import { serverSettings } from "./state/settings.ts"

const { button, form, span } = van.tags

// A search query is the normalized tag list rejoined into a single
// space-separated string. Normalization happens only when the search is sent,
// never per-keystroke, so in-progress editing (mixed case, stray spaces) is
// left untouched until then.
function normalizeQuery(raw: string): string {
    return normalizeTags(raw).join(" ")
}

export function SearchBar() {
    // The autocomplete input owns the field; we keep a ref to it so we can
    // reflect a normalized query back into the UI on submit, and a resync so
    // its ghost-text overlay picks up the programmatic rewrite.
    const inputRef = { current: null as HTMLInputElement | null }
    const resyncRef = { current: null as (() => void) | null }
    const favoritesScope = van.state(favoriteSearchId() !== null)

    const scopeIcon = span({ "icon-name": "globe", "aria-hidden": "true" })
    const scopeButton = button(
        {
            type: "button",
            onclick: () => {
                if (ownFavoriteId() !== null) favoritesScope.val = !favoritesScope.val
            },
        },
        scopeIcon,
    )

    // The field is created before the derive so the derive's immediate
    // first run already finds the ref set — otherwise a direct load of a
    // tagged list URL would only fill the field on the next navigation.
    const field = AutocompleteInput({
        leading: scopeButton,
        placeholder: "search rule34 using tags",
        ariaLabel: "Search using tags",
        onEnter: submit,
        inputRef,
        resyncRef,
        fetchSuggestions: (query) =>
            favoritesScope.rawVal ? fetchFavoriteAutocomplete(query) : fetchAutocomplete(query),
    })

    // The tag sidebar's + buttons reach this field through the module channel
    // (state/search-field.ts): they append a tag without submitting.
    if (inputRef.current !== null && resyncRef.current !== null)
        registerSearchField(inputRef.current, resyncRef.current)

    function ownFavoriteId(): number | null {
        if (!serverSettings.rawVal.enabled) return null
        const a = auth.rawVal
        if (a.status !== "authenticated") return null
        return a.userId
    }

    function favoriteSearchId(): number | null {
        const userId = ownFavoriteId()
        if (userId === null) return null
        const r = route.rawVal
        if (r.type === "favorites" && r.id === userId) return r.id
        if (r.type === "postdetails" && r.origin?.kind === "favorites" && r.origin.uid === userId)
            return r.origin.uid
        return null
    }

    van.derive(() => {
        route.val
        auth.val
        serverSettings.val
        const own = favoriteSearchId() !== null
        if (favoritesScope.rawVal !== own) favoritesScope.val = own
    })

    van.derive(() => {
        const own = favoritesScope.val
        scopeButton.className = clsx(
            "absolute top-1/2 left-1.5 z-10 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md",
            "transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40",
            own ? "text-rose-500 hover:bg-rose-500/10" : "text-emerald-500 hover:bg-emerald-500/10",
        )
        scopeButton.title = own ? "Search your favorites" : "Search all of Rule34"
        scopeButton.setAttribute(
            "aria-label",
            own
                ? "Searching your favorites; switch to all of Rule34"
                : "Searching all of Rule34; switch to your favorites",
        )
        scopeIcon.setAttribute("icon-name", own ? "heart" : "globe")
        inputRef.current?.setAttribute(
            "placeholder",
            own ? "search your favorites using tags" : "search rule34 using tags",
        )
        inputRef.current?.setAttribute(
            "aria-label",
            own ? "Search your favorites using tags" : "Search using tags",
        )
    })

    // Keep the field in step with the query carried by the route: direct
    // loads of a tagged list URL, back/forward, and post links (a
    // postdetails route carries the query the post was found under). Only
    // list/detail routes sync — the field is left alone on other pages.
    // The derive runs only when the route changes, so it never interrupts
    // typing — but navigating to a list or detail page discards whatever
    // unsubmitted text is in the field.
    van.derive(() => {
        const r = route.val
        if (r.type !== "postlist" && r.type !== "postdetails" && r.type !== "favorites") return
        const input = inputRef.current
        if (!input) return
        const q = r.tags ?? ""
        if (input.value === q) return
        input.value = q
        resyncRef.current?.()
    })

    function submit(): void {
        const input = inputRef.current
        const raw = input?.value ?? ""
        const normalized = normalizeQuery(raw)
        // Reflect the normalization in the UI (not just the request), then
        // release focus so mobile keyboards close and global shortcuts work.
        if (input) {
            input.value = normalized
            input.setSelectionRange(normalized.length, normalized.length)
            resyncRef.current?.()
            input.blur()
        }
        const favoriteId = favoritesScope.rawVal ? ownFavoriteId() : null
        if (favoriteId !== null) {
            const query = normalized === "" ? undefined : normalized
            const random = query?.split(" ").some((term) => term.startsWith("sort:random"))
            const seed = random ? Math.floor(Math.random() * 2_147_483_646) + 1 : undefined
            navigate({ type: "favorites", id: favoriteId, pid: 0, tags: query, seed })
            return
        }
        search(normalized === "" ? undefined : normalized)
    }

    return form(
        {
            class: "flex min-w-0 flex-1 items-center gap-2",
            role: "search",
            // The Search button submits the form; Enter in the field is routed
            // through onEnter (the autocomplete intercepts it). Both land here.
            onsubmit: (e: SubmitEvent) => {
                e.preventDefault()
                submit()
            },
        },
        field,
        button(
            {
                type: "submit",
                class: clsx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white",
                    "transition-colors hover:bg-rose-400",
                ),
                "aria-label": "Search",
            },
            span({ "icon-name": "search", "aria-hidden": "true" }),
        ),
    )
}

import van from "vanjs-core"

import { AutocompleteInput } from "./AutocompleteInput.ts"
import { Toggle } from "./Toggle.ts"
import clsx from "./clsx.ts"
import {
    preferOriginal,
    setPreferOriginal,
    setTagBlacklist,
    tagBlacklist,
} from "./state/settings.ts"

const { button, div, h1, h2, p, section, span } = van.tags

// A dismissible tag chip in the blacklist. The whole chip is the label; the
// small round button removes the tag.
function TagPill({ tag }: { tag: string }) {
    return span(
        {
            class: clsx(
                "flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/60",
                "py-1 pl-3 pr-1.5 text-sm text-zinc-200",
            ),
        },
        tag,
        button(
            {
                type: "button",
                "aria-label": `Remove ${tag} from the blacklist`,
                class: clsx(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                    "text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100",
                ),
                onclick: () => setTagBlacklist(tagBlacklist.val.filter((t) => t !== tag)),
            },
            "×",
        ),
    )
}

export function Settings() {
    // The autocomplete field is owned by AutocompleteInput; we keep a ref to
    // read/clear it when a tag is added.
    const inputRef = { current: null as HTMLInputElement | null }

    // Add one or more tags (the input may hold several, space-separated).
    // Tokens are lowercased and deduped against the existing list; the field
    // is cleared on every attempt.
    function addTags(raw: string): void {
        const set = new Set(tagBlacklist.val)
        let addedAny = false
        for (const part of raw.split(/\s+/)) {
            const token = part.trim().toLowerCase()
            if (token === "" || set.has(token)) continue
            set.add(token)
            addedAny = true
        }
        if (addedAny) setTagBlacklist([...set])
        clearInput()
    }

    function clearInput(): void {
        const input = inputRef.current
        if (input) {
            input.value = ""
            input.focus()
        }
    }

    return div(
        { class: "mx-auto flex w-full max-w-3xl flex-col gap-8" },
        div(
            { class: "flex flex-col gap-1" },
            h1({ class: "text-3xl font-semibold tracking-tight text-zinc-100" }, "Settings"),
            p({ class: "text-sm text-zinc-500" }, "Saved to this browser; no login required."),
        ),

        section(
            {
                class: "flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5",
            },
            div(
                { class: "flex flex-col gap-1" },
                h2({ class: "text-lg font-semibold text-zinc-100" }, "Tag blacklist"),
                p(
                    { class: "text-sm text-zinc-500" },
                    "Posts carrying any of these tags are hidden from the post list. Favorites and other pages are unaffected.",
                ),
            ),
            div(
                { class: "flex items-center gap-2" },
                AutocompleteInput({
                    placeholder: "Add a tag (e.g. ai_generated)",
                    ariaLabel: "Add a tag to the blacklist",
                    onAccept: addTags,
                    onEnter: addTags,
                    inputRef,
                }),
                button(
                    {
                        type: "button",
                        class: clsx(
                            "shrink-0 rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                            "transition-colors hover:bg-rose-400",
                        ),
                        onclick: () => addTags(inputRef.current?.value ?? ""),
                    },
                    "Add",
                ),
            ),
            // Live: re-renders as the blacklist changes. Always returns a node.
            () => {
                const tags = tagBlacklist.val
                if (tags.length === 0)
                    return p({ class: "text-sm text-zinc-600" }, "No tags blacklisted yet.")
                return div(
                    { class: "flex flex-wrap gap-2" },
                    tags.map((tag) => TagPill({ tag })),
                )
            },
        ),

        section(
            {
                class: "flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5",
            },
            div(
                { class: "flex flex-col gap-1" },
                h2({ class: "text-lg font-semibold text-zinc-100" }, "Image quality"),
                p({ class: "text-sm text-zinc-500" }, "How post images are loaded."),
            ),
            Toggle({
                label: "Load original image right away",
                description:
                    "Skip the sample image and load the full-resolution original on the post page.",
                state: preferOriginal,
                onToggle: setPreferOriginal,
            }),
        ),
    )
}

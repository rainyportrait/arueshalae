import van from "vanjs-core"

import { AutocompleteInput } from "./AutocompleteInput.ts"
import { SyncSettings } from "./SyncSettings.ts"
import { Toggle } from "./Toggle.ts"
import { getDownloadCount } from "./api/server.ts"
import { normalizeTags } from "./api/tags.ts"
import clsx from "./clsx.ts"
import { preferOriginal, serverSettings, tagBlacklist } from "./state/settings.ts"

const { button, div, h1, h2, input, p, section, span } = van.tags

// A dismissible tag chip in the blacklist. The whole chip is the label; the
// small round button removes the tag.
function TagPill({ tag }: { tag: string }) {
    return span(
        {
            class: clsx(
                "flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800/60",
                "py-1 pr-1.5 pl-3 text-sm text-zinc-200",
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
                onclick: () => (tagBlacklist.val = tagBlacklist.val.filter((t) => t !== tag)),
            },
            "×",
        ),
    )
}

export function Settings() {
    // The autocomplete field is owned by AutocompleteInput; we keep a ref to
    // read/clear it when a tag is added, and a resync so its ghost-text
    // overlay picks up the programmatic clear.
    const inputRef = { current: null as HTMLInputElement | null }
    const resyncRef = { current: null as (() => void) | null }

    // Add one or more tags (the input may hold several, space-separated).
    // Tokens are normalized with the shared normalizeTags (trim, lowercase,
    // dedupe) and deduped against the existing list; the field is cleared on
    // every attempt.
    function addTags(raw: string): void {
        const set = new Set(tagBlacklist.val)
        let addedAny = false
        for (const token of normalizeTags(raw)) {
            if (set.has(token)) continue
            set.add(token)
            addedAny = true
        }
        if (addedAny) tagBlacklist.val = [...set]
        clearInput()
    }

    function clearInput(): void {
        const input = inputRef.current
        if (input) {
            input.value = ""
            input.focus()
            resyncRef.current?.()
        }
    }

    // Server connection state. The enable toggle works on a derive over the
    // persisted object; the test result is local UI state that never persists.
    const serverEnabled = van.derive<boolean>(() => serverSettings.val.enabled)
    const preferDownloaded = van.derive<boolean>(
        () => serverSettings.val.preferDownloaded !== false,
    )
    const testing = van.state(false)
    const testResult = van.state<string | null>(null)

    async function testConnection(): Promise<void> {
        if (testing.val) return
        testing.val = true
        testResult.val = null
        try {
            const count = await getDownloadCount()
            testResult.val = `Connected — ${count} posts`
        } catch (err) {
            testResult.val = err instanceof Error ? err.message : String(err)
        } finally {
            testing.val = false
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
                class: clsx(
                    "flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5",
                ),
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
                    resyncRef,
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
                class: clsx(
                    "flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5",
                ),
            },
            div(
                { class: "flex flex-col gap-1" },
                h2({ class: "text-lg font-semibold text-zinc-100" }, "Image quality"),
                p({ class: "text-sm text-zinc-500" }, "How post images are loaded."),
            ),
            Toggle({
                label: "Load original image right away",
                description:
                    "When loading from Rule34, skip the sample image and load the full-resolution original.",
                state: preferOriginal,
                onToggle: (value) => (preferOriginal.val = value),
            }),
        ),

        section(
            {
                class: clsx(
                    "flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5",
                ),
            },
            div(
                { class: "flex flex-col gap-1" },
                h2({ class: "text-lg font-semibold text-zinc-100" }, "Arueshalae server"),
                p(
                    { class: "text-sm text-zinc-500" },
                    "Connect to the arueshalae server that mirrors your downloaded media.",
                ),
            ),
            Toggle({
                label: "Enable server support",
                description: "Let the userscript talk to the server.",
                state: serverEnabled,
                onToggle: (value) =>
                    (serverSettings.val = { ...serverSettings.val, enabled: value }),
            }),
            Toggle({
                label: "Prefer downloaded media",
                description:
                    "Serve images, videos, and thumbnails from your Arueshalae server when available.",
                state: preferDownloaded,
                onToggle: (value) =>
                    (serverSettings.val = { ...serverSettings.val, preferDownloaded: value }),
            }),
            div(
                { class: "flex items-center gap-2" },
                // Rendered once: writing state on input doesn't re-render the
                // field itself, so the caret is preserved while typing. The
                // trailing slash is stripped on blur.
                input({
                    type: "url",
                    value: serverSettings.val.url,
                    placeholder: "http://127.0.0.1:34343",
                    "aria-label": "Server URL",
                    class: clsx(
                        "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm",
                        "text-zinc-100 placeholder:text-zinc-600",
                        "focus:border-zinc-500 focus:outline-none",
                    ),
                    oninput: (e: Event) => {
                        const value = (e.target as HTMLInputElement).value
                        serverSettings.val = { ...serverSettings.val, url: value }
                    },
                    onblur: (e: Event) => {
                        const el = e.target as HTMLInputElement
                        const value = el.value.replace(/\/+$/, "")
                        if (value !== el.value) el.value = value
                        serverSettings.val = { ...serverSettings.val, url: value }
                    },
                }),
                button(
                    {
                        type: "button",
                        class: clsx(
                            "shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2",
                            "text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-700",
                        ),
                        onclick: () => void testConnection(),
                    },
                    () => (testing.val ? "Testing…" : "Test connection"),
                ),
            ),
            // Live: connection test status. Always returns a node.
            () => {
                if (testing.val) return p({ class: "text-sm text-zinc-500" }, "Testing connection…")
                const result = testResult.val
                if (result === null) return document.createComment("")
                return p(
                    {
                        class: clsx(
                            "text-sm",
                            result.startsWith("Connected") ? "text-emerald-400" : "text-rose-400",
                        ),
                    },
                    result,
                )
            },
            SyncSettings(),
        ),
    )
}

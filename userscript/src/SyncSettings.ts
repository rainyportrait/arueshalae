import van from "vanjs-core"

import { serverBaseUrl } from "./api/server.ts"
import { syncCommand } from "./api/sync.ts"
import clsx from "./clsx.ts"
import { auth } from "./state/auth.ts"
import { type LibraryPost } from "./state/library.ts"
import { serverSettings } from "./state/settings.ts"
import {
    fullScan,
    startFullScan,
    syncConfiguration,
    syncControl,
    syncError,
    syncStatus,
} from "./state/sync.ts"

const { a, button, div, h3, input, label, option, p, select, span } = van.tags
const PAGE_SIZE = 50

export function SyncSettings() {
    let configuredBody: HTMLDivElement | null = null

    return div(
        { class: "flex flex-col gap-4 border-t border-zinc-800 pt-5" },
        div(
            h3({ class: "font-semibold text-zinc-100" }, "Favorite synchronization"),
            p(
                { class: "mt-1 text-sm text-zinc-500" },
                "The userscript discovers favorites on rule34. The local server only stores results and media.",
            ),
        ),
        () => {
            if (!serverSettings.val.enabled) {
                return Notice("Enable server support to configure favorite synchronization.")
            }
            const account = auth.val
            const configuration = syncConfiguration.val
            if (account.status !== "authenticated") {
                return Notice("Sign in to rule34 before configuring synchronization.")
            }
            if (configuration === "unknown") return Notice("Checking the server configuration…")
            if (configuration === "missing") {
                return div(
                    { class: "flex flex-col items-start gap-3" },
                    p(
                        { class: "text-sm text-zinc-400" },
                        "This server has not been linked to an account.",
                    ),
                    ActionButton("Link account", () => runControl("configure"), true),
                )
            }

            configuredBody ??= ConfiguredSynchronization()
            return configuredBody
        },
        () => (syncError.val === "" ? document.createComment("") : Notice(syncError.val, "error")),
    )
}

function ConfiguredSynchronization() {
    return div(
        { class: "flex flex-col gap-5" },
        () => {
            const status = syncStatus.val
            return status === null ? document.createComment("") : Summary(status)
        },
        () => {
            const status = syncStatus.val
            return status === null ? document.createComment("") : ScanControls(status)
        },
        () => {
            const status = syncStatus.val
            return status === null ? document.createComment("") : DownloadControls(status)
        },
        LibraryBrowser(),
    )
}

function Summary(status: NonNullable<typeof syncStatus.val>) {
    const figures = [
        [status.active, "favorites"],
        [status.downloaded, "downloaded"],
        [status.pending, "waiting"],
        [status.archived, "archived"],
    ] as const
    return div(
        { class: "grid grid-cols-2 gap-2 sm:grid-cols-4" },
        figures.map(([value, caption]) =>
            div(
                { class: "rounded-lg border border-zinc-800 bg-zinc-950/40 p-3" },
                p({ class: "text-xl font-semibold text-zinc-100" }, value.toLocaleString()),
                p({ class: "text-xs text-zinc-500" }, caption),
            ),
        ),
    )
}

function ScanControls(status: NonNullable<typeof syncStatus.val>) {
    const scan = fullScan.val
    const offset = status.countOffset
    return div(
        { class: "flex flex-col gap-3 rounded-lg border border-zinc-800 p-4" },
        div(
            p({ class: "font-medium text-zinc-200" }, "Favorite discovery"),
            p(
                { class: "text-sm text-zinc-500" },
                !status.baselineReady
                    ? "Run a full scan to establish the ordered baseline. Closing this tab cancels it."
                    : `${status.baselineCount.toLocaleString()} favorites in the baseline. Count correction: ${formatOffset(offset)}.`,
            ),
        ),
        scan.status === "idle"
            ? document.createComment("")
            : Notice(scan.message, scan.status === "failed" ? "error" : "normal"),
        div(
            { class: "flex flex-wrap gap-2" },
            ActionButton(
                scan.status === "running" ? "Scanning…" : "Run full scan",
                () => void startFullScan(),
                true,
                scan.status === "running",
            ),
            ActionButton(
                status.incrementalPaused ? "Resume background checks" : "Pause background checks",
                () =>
                    runControl("pause", {
                        kind: "incremental",
                        value: String(!status.incrementalPaused),
                    }),
            ),
        ),
        label(
            { class: "flex items-center gap-3 text-sm text-zinc-400" },
            "Request limit per background check",
            input({
                type: "number",
                min: 1,
                max: 1000,
                value: status.budget,
                class: "w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100",
                onchange: (event: Event) =>
                    runControl("budget", {
                        count: Number((event.target as HTMLInputElement).value),
                    }),
            }),
        ),
        status.lastResult === null
            ? document.createComment("")
            : p({ class: "text-xs text-zinc-500" }, `Last check: ${status.lastResult}`),
    )
}

function DownloadControls(status: NonNullable<typeof syncStatus.val>) {
    return div(
        { class: "flex flex-col gap-3 rounded-lg border border-zinc-800 p-4" },
        div(
            p({ class: "font-medium text-zinc-200" }, "Media downloads"),
            p(
                { class: "text-sm text-zinc-500" },
                "Discovered favorites are downloaded separately, one at a time. Existing media is retained when unfavorited.",
            ),
        ),
        div(
            { class: "flex flex-wrap gap-2" },
            ActionButton(status.downloadsPaused ? "Resume downloads" : "Pause downloads", () =>
                runControl("pause", {
                    kind: "downloads",
                    value: String(!status.downloadsPaused),
                }),
            ),
            ActionButton("Retry failed", () => runControl("retry")),
        ),
    )
}

type LibraryFilter = "active" | "archived" | "all"

function LibraryBrowser() {
    const posts = van.state<LibraryPost[]>([])
    const filter = van.state<LibraryFilter>("active")
    const offset = van.state(0)
    let sequence = 0

    van.derive(() => {
        const currentFilter = filter.val
        const position = offset.val
        const request = ++sequence
        void syncCommand<{ posts: LibraryPost[] }>("library", {
            value: currentFilter,
            position,
        }).then((response) => {
            if (request === sequence) posts.val = response.posts
        })
    })

    return div(
        { class: "flex flex-col gap-3" },
        div(
            { class: "flex items-center justify-between gap-3" },
            p({ class: "font-medium text-zinc-200" }, "Library records"),
            select(
                {
                    class: "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm",
                    onchange: (event: Event) => {
                        filter.val = (event.target as HTMLSelectElement).value as LibraryFilter
                        offset.val = 0
                    },
                },
                option({ value: "active" }, "Favorites"),
                option({ value: "archived" }, "Archived"),
                option({ value: "all" }, "Everything"),
            ),
        ),
        () =>
            posts.val.length === 0
                ? p({ class: "text-sm text-zinc-600" }, "No records in this view.")
                : div(
                      {
                          class: "divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800",
                      },
                      posts.val.map(LibraryRow),
                  ),
        div(
            { class: "flex gap-2" },
            ActionButton(
                "Previous",
                () => (offset.val = Math.max(0, offset.val - PAGE_SIZE)),
                false,
                offset.val === 0,
            ),
            ActionButton(
                "Next",
                () => (offset.val += PAGE_SIZE),
                false,
                posts.val.length < PAGE_SIZE,
            ),
        ),
    )
}

function LibraryRow(post: LibraryPost) {
    const href = post.downloaded
        ? `${serverBaseUrl()}/api/posts/${post.postId}/media`
        : `/index.php?page=post&s=view&id=${post.postId}`
    return a(
        {
            href,
            target: "_blank",
            rel: "noopener",
            class: "flex items-center justify-between gap-3 bg-zinc-950/30 px-3 py-2 text-sm hover:bg-zinc-800/50",
        },
        span({ class: "font-mono text-zinc-300" }, post.postId),
        span(
            { class: "text-right text-xs text-zinc-500" },
            [post.membership, post.availability, post.downloaded ? "downloaded" : "no media"].join(
                " · ",
            ),
        ),
    )
}

function ActionButton(text: string, action: () => void, primary = false, disabled = false) {
    return button(
        {
            type: "button",
            disabled,
            class: clsx(
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                primary
                    ? "bg-rose-500 text-white hover:bg-rose-400"
                    : "border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700",
            ),
            onclick: action,
        },
        text,
    )
}

function Notice(message: string, tone: "normal" | "error" = "normal") {
    return p(
        {
            class: clsx(
                "rounded-lg border px-3 py-2 text-sm",
                tone === "error"
                    ? "border-rose-900/60 bg-rose-950/30 text-rose-300"
                    : "border-zinc-800 bg-zinc-950/40 text-zinc-400",
            ),
        },
        message,
    )
}

function runControl(action: string, data: Record<string, unknown> = {}): void {
    void syncControl(action, data).catch((error) => {
        syncError.val = error instanceof Error ? error.message : String(error)
    })
}

function formatOffset(offset: number): string {
    if (offset === 0) return "none"
    return offset > 0 ? `+${offset}` : String(offset)
}

import van from "vanjs-core"

import { serverBaseUrl } from "./api/server.ts"
import { syncCommand } from "./api/sync.ts"
import { auth } from "./state/auth.ts"
import { type LibraryPost } from "./state/library.ts"
import { type SyncStatus, syncControl, syncError, syncStatus } from "./state/sync.ts"

const { section, h2, p, button, div, a, select, option, input, label } = van.tags

type LibraryFilter = "active" | "archived" | "all"

const LIBRARY_PAGE_SIZE = 50
const CONFIGURATION_HELP = [
    "Configure the server account to begin.",
    "An initial full scan must be started manually.",
].join(" ")
const BASELINE_HELP = [
    "An ordered baseline is available.",
    "Incremental checks do not prove full agreement.",
].join(" ")

export function SyncSettings() {
    return section({ class: "space-y-3" }, SyncOverview(), LibraryBrowser(), () =>
        p({ class: "text-sm text-amber-300" }, syncError.val),
    )
}

function SyncOverview() {
    return div(
        { class: "contents" },
        h2({ class: "text-lg font-semibold" }, "Library synchronization"),
        () => {
            const account = auth.val
            return p(
                account.status === "authenticated"
                    ? `Account ${account.userId}`
                    : "Sign in to configure synchronization",
            )
        },
        controlButton("Configure this account", "configure"),
        () => {
            const status = syncStatus.val
            if (status === null) {
                return p(CONFIGURATION_HELP)
            }

            return SyncControls(status)
        },
    )
}

function SyncControls(status: SyncStatus) {
    const totals = [
        `${status.active} active favorites`,
        `${status.downloaded} downloaded`,
        `${status.pending} pending`,
        `${status.archived} unfavorited`,
        `${status.deleted} deleted upstream`,
    ].join(" · ")

    return div(
        { class: "space-y-3" },
        p(totals),
        requestBudget(status.budget),
        p(status.baseline === null ? "No verified baseline yet" : BASELINE_HELP),
        p(
            status.run === null
                ? "No scan started"
                : [status.run.status, `${status.run.checkpoint} entries`, status.run.message]
                      .filter((part) => part !== null && part !== "")
                      .join(" · "),
        ),
        div(
            { class: "flex flex-wrap gap-2" },
            controlButton("Start full scan", "full"),
            controlButton("Cancel scan", "cancel"),
            controlButton(
                status.reconciliationPaused ? "Resume reconciliation" : "Pause reconciliation",
                "pause",
                {
                    worker: "reconciliation",
                    value: String(!status.reconciliationPaused),
                },
            ),
            controlButton(
                status.downloadsPaused ? "Resume downloads" : "Pause downloads",
                "pause",
                { worker: "download", value: String(!status.downloadsPaused) },
            ),
            controlButton("Retry failed downloads", "retry"),
        ),
    )
}

function requestBudget(budget: number) {
    return label(
        { class: "flex items-center gap-2 text-sm" },
        "Requests per incremental check",
        input({
            type: "number",
            min: 1,
            max: 1000,
            value: budget,
            class: "w-24 rounded bg-zinc-800 p-2",
            onchange: (event: Event) => {
                const count = Number((event.target as HTMLInputElement).value)
                runControl("budget", { count })
            },
        }),
    )
}

function controlButton(text: string, action: string, data: Record<string, unknown> = {}) {
    return button(
        {
            type: "button",
            class: "rounded bg-zinc-700 px-3 py-2 text-sm",
            onclick: () => runControl(action, data),
        },
        text,
    )
}

function runControl(action: string, data: Record<string, unknown> = {}): void {
    void syncControl(action, data).catch((error) => {
        syncError.val = String(error)
    })
}

function LibraryBrowser() {
    const posts = van.state<LibraryPost[]>([])
    const filter = van.state<LibraryFilter>("active")
    const offset = van.state(0)
    let requestSequence = 0

    // Status polling is also the refresh trigger for the visible library page.
    // The sequence prevents an older page request from overwriting a newer one.
    van.derive(() => {
        const currentFilter = filter.val
        const position = offset.val
        const status = syncStatus.val
        const sequence = ++requestSequence
        if (status === null) return

        void syncCommand<{ posts: LibraryPost[] }>("library", {
            value: currentFilter,
            position,
        }).then(
            (response) => {
                if (sequence === requestSequence) posts.val = response.posts
            },
            (error) => {
                syncError.val = String(error)
            },
        )
    })

    return div(
        { class: "contents" },
        h2({ class: "text-lg font-semibold" }, "Local library"),
        select(
            {
                class: "rounded bg-zinc-800 p-2",
                onchange: (event: Event) => {
                    filter.val = (event.target as HTMLSelectElement).value as LibraryFilter
                    offset.val = 0
                },
            },
            option({ value: "active" }, "Active and preserved deleted posts"),
            option({ value: "archived" }, "Unfavorited copies"),
            option({ value: "all" }, "All records"),
        ),
        () => LibraryPostLinks(posts.val),
        div(
            { class: "flex gap-2" },
            button(
                {
                    type: "button",
                    disabled: () => offset.val === 0,
                    onclick: () => {
                        offset.val = Math.max(0, offset.val - LIBRARY_PAGE_SIZE)
                    },
                },
                "Previous",
            ),
            button(
                {
                    type: "button",
                    disabled: () => posts.val.length < LIBRARY_PAGE_SIZE,
                    onclick: () => {
                        offset.val += LIBRARY_PAGE_SIZE
                    },
                },
                "Next",
            ),
        ),
    )
}

function LibraryPostLinks(posts: LibraryPost[]) {
    return div(
        { class: "flex flex-wrap gap-2" },
        posts.map((post) =>
            a(
                {
                    href: post.downloaded
                        ? `${serverBaseUrl()}/api/posts/${post.postId}/media`
                        : `/index.php?page=post&s=view&id=${post.postId}`,
                    target: "_blank",
                    rel: "noopener",
                    class: "rounded bg-zinc-800 p-2 text-sm",
                },
                libraryPostLabel(post),
            ),
        ),
    )
}

function libraryPostLabel(post: LibraryPost): string {
    const media = post.downloaded ? "downloaded" : "no local media"
    return `${post.postId} · ${post.membership} · ${post.availability} · ${media}`
}

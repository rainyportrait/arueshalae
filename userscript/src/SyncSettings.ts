import van from "vanjs-core"

import { serverBaseUrl } from "./api/server.ts"
import { syncCommand } from "./api/sync.ts"
import { auth } from "./state/auth.ts"
import { type LibraryPost } from "./state/library.ts"
import { syncControl, syncError, syncStatus } from "./state/sync.ts"

const { section, h2, p, button, div, a, select, option, input, label } = van.tags

export function SyncSettings() {
    const act =
        (action: string, data: Record<string, unknown> = {}) =>
        () =>
            void syncControl(action, data).catch((e) => {
                syncError.val = String(e)
            })

    const control = (label: string, action: string, data: Record<string, unknown> = {}) =>
        button(
            {
                type: "button",
                class: "rounded bg-zinc-700 px-3 py-2 text-sm",
                onclick: act(action, data),
            },
            label,
        )

    const posts = van.state<LibraryPost[]>([])
    const filter = van.state("active")
    const offset = van.state(0)
    let sequence = 0

    van.derive(() => {
        const value = filter.val,
            position = offset.val,
            status = syncStatus.val
        const current = ++sequence
        if (!status) return
        void syncCommand<{ posts: LibraryPost[] }>("library", { value, position }).then(
            (r) => {
                if (current === sequence) posts.val = r.posts
            },
            (e) => {
                syncError.val = String(e)
            },
        )
    })

    return section(
        { class: "space-y-3" },
        h2({ class: "text-lg font-semibold" }, "Library synchronization"),
        () => {
            const a = auth.val
            return p(
                a.status === "authenticated"
                    ? `Account ${a.userId}`
                    : "Sign in to configure synchronization",
            )
        },
        control("Configure this account", "configure"),
        () => {
            const s = syncStatus.val
            if (!s)
                return p(
                    "Configure the server account to begin. An initial full scan must be started manually.",
                )
            return div(
                { class: "space-y-3" },
                p(
                    `${s.active} active favorites · ${s.downloaded} downloaded · ${s.pending} pending · ${s.archived} unfavorited · ${s.deleted} deleted upstream`,
                ),
                label(
                    { class: "flex items-center gap-2 text-sm" },
                    "Requests per incremental check",
                    input({
                        type: "number",
                        min: 1,
                        max: 1000,
                        value: s.budget,
                        class: "w-24 rounded bg-zinc-800 p-2",
                        onchange: (event: Event) => {
                            void syncControl("budget", {
                                count: Number((event.target as HTMLInputElement).value),
                            }).catch((e) => {
                                syncError.val = String(e)
                            })
                        },
                    }),
                ),
                p(
                    s.baseline === null
                        ? "No verified baseline yet"
                        : "An ordered baseline is available. Incremental checks do not prove full agreement.",
                ),
                p(
                    s.run
                        ? `${s.run.status} · ${s.run.checkpoint} entries · ${s.run.message ?? ""}`
                        : "No scan started",
                ),
                div(
                    { class: "flex flex-wrap gap-2" },
                    control("Start full scan", "full"),
                    control("Cancel scan", "cancel"),
                    control(
                        s.reconciliationPaused ? "Resume reconciliation" : "Pause reconciliation",
                        "pause",
                        { worker: "reconciliation", value: String(!s.reconciliationPaused) },
                    ),
                    control(s.downloadsPaused ? "Resume downloads" : "Pause downloads", "pause", {
                        worker: "download",
                        value: String(!s.downloadsPaused),
                    }),
                    control("Retry failed downloads", "retry"),
                ),
            )
        },
        h2({ class: "text-lg font-semibold" }, "Local library"),
        select(
            {
                class: "rounded bg-zinc-800 p-2",
                onchange: (event: Event) => {
                    filter.val = (event.target as HTMLSelectElement).value
                    offset.val = 0
                },
            },
            option({ value: "active" }, "Active and preserved deleted posts"),
            option({ value: "archived" }, "Unfavorited copies"),
            option({ value: "all" }, "All records"),
        ),
        () =>
            div(
                { class: "flex flex-wrap gap-2" },
                posts.val.map((post) =>
                    a(
                        {
                            href: post.downloaded
                                ? `${serverBaseUrl()}/api/posts/${post.postId}/media`
                                : `/index.php?page=post&s=view&id=${post.postId}`,
                            target: "_blank",
                            rel: "noopener",
                            class: "rounded bg-zinc-800 p-2 text-sm",
                        },
                        `${post.postId} · ${post.membership} · ${post.availability}${post.downloaded ? " · downloaded" : " · no local media"}`,
                    ),
                ),
            ),
        div(
            { class: "flex gap-2" },
            button(
                {
                    type: "button",
                    disabled: () => offset.val === 0,
                    onclick: () => {
                        offset.val = Math.max(0, offset.val - 50)
                    },
                },
                "Previous",
            ),
            button(
                {
                    type: "button",
                    disabled: () => posts.val.length < 50,
                    onclick: () => {
                        offset.val += 50
                    },
                },
                "Next",
            ),
        ),
        () => p({ class: "text-sm text-amber-300" }, syncError.val),
    )
}

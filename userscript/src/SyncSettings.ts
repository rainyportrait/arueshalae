import van from "vanjs-core"

import { auth } from "./state/auth.ts"
import { startSync, syncRun, syncStatus } from "./state/sync.ts"

const { button, div, p } = van.tags

export function SyncSettings() {
    return div(
        { class: "flex flex-col gap-3 border-t border-zinc-800 pt-4" },
        div(
            p({ class: "font-medium text-zinc-200" }, "Favorite synchronization"),
            p(
                { class: "text-sm text-zinc-500" },
                "Sync discovers changes on rule34, then downloads every favorite missing media.",
            ),
        ),
        () => {
            const status = syncStatus.val
            if (status === null) return document.createComment("")
            if (!status.initialized) {
                return p({ class: "text-sm text-zinc-500" }, "The first Sync reads every favorite.")
            }
            return p(
                { class: "text-sm text-zinc-500" },
                `${status.favorites.toLocaleString()} favorites · ${status.pending.toLocaleString()} missing media`,
            )
        },
        () => {
            const run = syncRun.val
            return run.status === "idle"
                ? document.createComment("")
                : p(
                      {
                          class:
                              run.status === "failed"
                                  ? "text-sm text-rose-400"
                                  : "text-sm text-zinc-400",
                      },
                      run.message,
                  )
        },
        button(
            {
                type: "button",
                class: "self-start rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50",
                disabled: () =>
                    syncRun.val.status === "running" || auth.val.status !== "authenticated",
                onclick: () => void startSync(),
            },
            () => (syncRun.val.status === "running" ? "Syncing…" : "Sync"),
        ),
    )
}

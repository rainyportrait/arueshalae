import van from "vanjs-core"

import { getPruneCount, pruneUnfavoritedPosts } from "./api/server.ts"
import clsx from "./clsx.ts"
import { serverSettings } from "./state/settings.ts"

const { button, div, p, span } = van.tags

// How long the "Are you sure?" confirmation stays armed before it expires on
// its own, so a stale confirmation can't fire the prune much later.
const PRUNE_CONFIRM_TIMEOUT_MS = 4_000
// Clicks this close to arming are ignored: a fast accidental double click
// must not run the destructive prune.
const PRUNE_CONFIRM_GUARD_MS = 500

// Millisecond-based, for the check timestamp kept locally (the server's
// lastSyncAt arrives as unixepoch seconds and is formatted by SyncTool).
function relativeTime(timestampMs: number): string {
    const minutes = Math.round((Date.now() - timestampMs) / 60_000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    const days = Math.round(hours / 24)
    if (days < 30) return `${days} d ago`
    return `${Math.round(days / 30)} mo ago`
}

// The prune tool card. Shares its skeleton with the sync card (SyncTool):
// label, description, a prominent count, and a pinned bottom block holding
// the state line and the action.
export function PruneTool() {
    const pruneCount = van.state<number | null>(null)
    const pruneCheckedAt = van.state<number | null>(null)
    const pruneStatus = van.state<"idle" | "loading" | "pruning">("idle")
    const pruneMessage = van.state<string | null>(null)
    // Prune confirmation: the first click arms the "Are you sure?" state,
    // the second click runs the prune once the double-click guard has passed.
    const pruneArmed = van.state(false)
    let armedAt = 0
    let armExpiry: number | null = null

    function disarmPrune(): void {
        pruneArmed.val = false
        if (armExpiry !== null) {
            window.clearTimeout(armExpiry)
            armExpiry = null
        }
    }

    function armPrune(): void {
        pruneArmed.val = true
        armedAt = Date.now()
        armExpiry = window.setTimeout(disarmPrune, PRUNE_CONFIRM_TIMEOUT_MS)
    }

    function handlePruneClick(): void {
        if (pruneStatus.val !== "idle") return
        const count = pruneCount.val
        if (count === null || count === 0) {
            void refreshPruneCount()
            return
        }
        if (!pruneArmed.val) {
            armPrune()
            return
        }
        if (Date.now() - armedAt < PRUNE_CONFIRM_GUARD_MS) return
        disarmPrune()
        void prune()
    }

    async function refreshPruneCount(): Promise<void> {
        if (pruneStatus.val !== "idle") return
        pruneStatus.val = "loading"
        pruneMessage.val = null
        try {
            pruneCount.val = await getPruneCount()
            pruneCheckedAt.val = Date.now()
        } catch (err) {
            pruneMessage.val = err instanceof Error ? err.message : String(err)
        } finally {
            pruneStatus.val = "idle"
        }
    }

    async function prune(): Promise<void> {
        if (pruneStatus.val !== "idle" || !pruneCount.val) return
        pruneStatus.val = "pruning"
        pruneMessage.val = null
        try {
            const count = await pruneUnfavoritedPosts()
            pruneCount.val = 0
            pruneMessage.val = `Pruned ${count.toLocaleString()} ${count === 1 ? "post" : "posts"}.`
        } catch (err) {
            pruneMessage.val = err instanceof Error ? err.message : String(err)
        } finally {
            pruneStatus.val = "idle"
        }
    }

    if (serverSettings.val.url.trim() !== "") {
        void refreshPruneCount()
    }

    return div(
        {
            class: "flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4",
        },
        div({ class: "text-sm font-medium text-zinc-200" }, "Prune unfavorited posts"),
        p(
            { class: "text-sm text-zinc-500" },
            "Remove database entries and local media only for posts confirmed unfavorited. Posts deleted from Rule34 are kept.",
        ),
        // Live: the count follows the last check. Always returns a node.
        () => {
            const count = pruneCount.val
            return div(
                { class: "flex items-baseline gap-1.5" },
                span(
                    {
                        class: clsx(
                            "text-2xl font-semibold tracking-tight tabular-nums",
                            count === null ? "text-zinc-600" : "text-zinc-100",
                        ),
                    },
                    count === null ? "–" : count.toLocaleString(),
                ),
                span({ class: "text-sm text-zinc-500" }, "eligible posts"),
            )
        },
        div(
            { class: "mt-auto flex flex-col gap-2" },
            // Live: the state line — the outcome message while it is set,
            // otherwise when the count was last checked. Always returns a node.
            () => {
                const message = pruneMessage.val
                if (message !== null)
                    return p(
                        {
                            class: clsx(
                                "text-[13px]",
                                message.startsWith("Pruned") ? "text-emerald-400" : "text-rose-400",
                            ),
                        },
                        message,
                    )
                const count = pruneCount.val
                const text =
                    count === null
                        ? pruneStatus.val === "loading"
                            ? "Checking…"
                            : "Not checked yet"
                        : count === 0
                          ? "Nothing to prune"
                          : `Last checked ${relativeTime(pruneCheckedAt.val ?? Date.now())}`
                return p({ class: "text-[13px] text-zinc-500" }, text)
            },
            button(
                {
                    type: "button",
                    class: clsx(
                        "w-full rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                        "hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50",
                    ),
                    disabled: () => pruneStatus.val !== "idle",
                    onclick: handlePruneClick,
                },
                () => {
                    if (pruneStatus.val === "pruning") return "Pruning…"
                    const count = pruneCount.val
                    if (count === 0) return "Check again"
                    if (count === null) return "Check prune"
                    if (pruneArmed.val) return "Are you sure?"
                    return `Prune ${count.toLocaleString()} ${count === 1 ? "post" : "posts"}`
                },
            ),
        ),
    )
}

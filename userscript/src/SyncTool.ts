import van from "vanjs-core"

import clsx from "./clsx.ts"
import { auth } from "./state/auth.ts"
import { type SyncPhase, startSync, syncRun, syncStatus } from "./state/sync.ts"

const { button, div, p, span } = van.tags

// lastSyncAt is a unixepoch() value in seconds, not milliseconds. A future
// timestamp (server clock skew) clamps to "just now".
function relativeTime(timestamp: number): string {
    const minutes = Math.round((Date.now() - timestamp * 1000) / 60_000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes} min ago`
    const hours = Math.round(minutes / 60)
    if (hours < 24) return `${hours} h ago`
    const days = Math.round(hours / 24)
    if (days < 30) return `${days} d ago`
    const months = Math.round(days / 30)
    if (months < 12) return `${months} mo ago`
    return `${Math.round(days / 365)} y ago`
}

function phaseCaption(phase: SyncPhase): string {
    switch (phase.phase) {
        case "starting":
            return "Starting synchronization…"
        case "reading":
            return `Reading favorites — page ${phase.page} of ${phase.pages}`
        case "verifying":
            return "Verifying favorites have not changed"
        case "checking-removals":
            return `Checking removed favorite ${phase.done} of ${phase.total}`
        case "downloading":
            return `Downloading media — ${phase.done} of ${phase.total}`
    }
}

// How far the phase is through its own work, or null for phases without a
// known total (the indeterminate sweep shows while they run).
function phaseFraction(phase: SyncPhase): number | null {
    switch (phase.phase) {
        case "reading":
            return phase.page / phase.pages
        case "checking-removals":
            return phase.done / phase.total
        case "downloading":
            return phase.done / phase.total
        case "starting":
        case "verifying":
            return null
    }
}

// The synchronization tool card. Shares its skeleton with the prune card
// (PruneTool): label, description, a prominent count, and a bottom block
// (state line, progress run area, button) pinned to the card's foot so the
// two cards line up whatever their content lengths.
export function SyncTool() {
    // The run area is one stable node mutated in place by the live function
    // below: vanjs replaces children with a new identity, and a fresh fill
    // element would restart the width transition from zero on every update.
    const fill = div({ class: "h-full rounded-full bg-rose-500 transition-[width] duration-300" })
    const sweep = div({ class: "loading-bar" })
    const bar = div(
        { class: "relative h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" },
        fill,
        sweep,
    )
    const caption = p({ class: "text-sm text-zinc-400" })
    const runArea = div({ class: "flex flex-col gap-1.5" }, bar, caption)
    fill.style.width = "0%"

    // The button is one stable element kept in the card's bottom block.
    const syncButton = button(
        {
            type: "button",
            class: clsx(
                "w-full rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white",
                "hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50",
            ),
            disabled: () => syncRun.val.status === "running" || auth.val.status !== "authenticated",
            onclick: () => void startSync(),
        },
        () => (syncRun.val.status === "running" ? "Syncing…" : "Sync"),
    )

    return div(
        {
            class: "flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4",
        },
        div({ class: "text-sm font-medium text-zinc-200" }, "Favorite synchronization"),
        p(
            { class: "text-sm text-zinc-500" },
            "Sync discovers changes on rule34, then downloads every favorite missing media.",
        ),
        // Live: the count follows the sync status. Always returns a node.
        () => {
            const status = syncStatus.val
            const empty = status === null || !status.initialized
            return div(
                { class: "flex items-baseline gap-1.5" },
                span(
                    {
                        class: clsx(
                            "text-2xl font-semibold tracking-tight tabular-nums",
                            empty ? "text-zinc-600" : "text-zinc-100",
                        ),
                    },
                    empty ? "–" : status.favorites.toLocaleString(),
                ),
                span({ class: "text-sm text-zinc-500" }, "favorites"),
            )
        },
        div(
            { class: "mt-auto flex flex-col gap-2" },
            // Live: the plain state line — pending count and last sync time
            // in one muted line. Always returns a node.
            () => {
                const status = syncStatus.val
                let text: string
                if (status === null) text = "Not synced yet"
                else if (!status.initialized) text = "Never synced"
                else {
                    text =
                        status.pending > 0
                            ? `${status.pending.toLocaleString()} missing`
                            : "up to date"
                    if (status.lastSyncAt !== null)
                        text += ` · last synced ${relativeTime(status.lastSyncAt)}`
                }
                return p({ class: "text-[13px] text-zinc-500" }, text)
            },
            // Live: the progress run area. Always returns a node.
            () => {
                const run = syncRun.val
                if (run.status === "idle") return document.createComment("")
                if (run.status === "failed") {
                    bar.style.display = "none"
                    caption.className = "text-sm text-rose-400"
                    caption.textContent = run.message
                    return runArea
                }
                const done = run.status === "complete"
                const fraction = done ? 1 : phaseFraction(run.phase)
                bar.style.display = ""
                if (fraction === null) {
                    sweep.style.display = ""
                    fill.style.width = "0%"
                } else {
                    sweep.style.display = "none"
                    fill.style.width = `${Math.round(fraction * 100)}%`
                }
                fill.className = done
                    ? "h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                    : "h-full rounded-full bg-rose-500 transition-[width] duration-300"
                caption.className = done ? "text-sm text-emerald-400" : "text-sm text-zinc-400"
                caption.textContent = done ? run.message : phaseCaption(run.phase)
                return runArea
            },
            syncButton,
        ),
    )
}

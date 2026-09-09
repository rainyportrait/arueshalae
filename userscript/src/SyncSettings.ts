import van from "vanjs-core"

import clsx from "./clsx.ts"
import { auth } from "./state/auth.ts"
import { type SyncPhase, startSync, syncRun, syncStatus } from "./state/sync.ts"

const { button, div, p, span } = van.tags

// A compact stat badge in the tag-pill vocabulary: a prominent number with a
// muted label.
function StatChip(value: string, label: string) {
    return span(
        {
            class: clsx(
                "inline-flex items-baseline gap-1.5 rounded-full border border-zinc-700",
                "bg-zinc-800/60 px-3 py-1 text-sm",
            ),
        },
        span({ class: "font-medium tabular-nums text-zinc-100" }, value),
        span({ class: "text-zinc-500" }, label),
    )
}

function UpToDateChip() {
    return span(
        {
            class: clsx(
                "rounded-full border border-emerald-900 bg-emerald-950/40",
                "px-3 py-1 text-sm text-emerald-400",
            ),
        },
        "media up to date",
    )
}

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
// known total (the bar is hidden while they run).
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

export function SyncSettings() {
    // The run area is one stable node mutated in place by the live function
    // below. vanjs replaces any child with a new identity, and a fresh fill
    // element would restart the width transition from zero on every update,
    // so the bar and caption are created once and written directly.
    const fill = div({ class: "h-full rounded-full transition-[width] duration-300" })
    const bar = div({ class: "h-1.5 w-full overflow-hidden rounded-full bg-zinc-800" }, fill)
    const caption = p({ class: "text-sm text-center" })
    const runArea = div({ class: "flex flex-col gap-1.5" }, bar, caption)
    fill.style.width = "0%"

    // The button is one stable element that the status row below re-parents
    // on every render (its live disabled/label props survive the move).
    const syncButton = button(
        {
            type: "button",
            class: "rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-50 grow",
            disabled: () => syncRun.val.status === "running" || auth.val.status !== "authenticated",
            onclick: () => void startSync(),
        },
        () => (syncRun.val.status === "running" ? "Syncing…" : "Sync"),
    )

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
            if (status === null || !status.initialized) {
                // Without a status there is no chip to lead the row; a comment
                // keeps the row shape (and the button's width) stable.
                const lead =
                    status === null
                        ? document.createComment("")
                        : p(
                              { class: "text-sm text-zinc-500" },
                              "The first Sync reads every favorite.",
                          )
                return div({ class: "flex flex-wrap items-center gap-2" }, lead, syncButton)
            }
            return div(
                { class: "flex justify-center" },
                div(
                    { class: "flex flex-wrap flex-col gap-2 w-fit" },
                    div(
                        { class: "flex flex-wrap gap-2 justify-center items-center" },
                        StatChip(`${status.favorites.toLocaleString()}`, "favorites"),
                        status.pending > 0
                            ? StatChip(`${status.pending.toLocaleString()}`, "missing media")
                            : UpToDateChip(),
                        status.lastSyncAt === null
                            ? document.createComment("")
                            : span(
                                  { class: "text-xs text-zinc-600" },
                                  `Last synced ${relativeTime(status.lastSyncAt)}`,
                              ),
                    ),
                    div({ class: "flex flex-wrap gap-2 justify-center" }, syncButton),
                    () => {
                        const run = syncRun.val
                        if (run.status === "idle") return document.createComment("")
                        if (run.status === "failed")
                            return p({ class: "text-sm text-rose-400" }, run.message)
                        const done = run.status === "complete"
                        const fraction = done ? 1 : phaseFraction(run.phase)
                        fill.style.width = `${Math.round((fraction ?? 0) * 100)}%`
                        fill.className = done
                            ? "h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                            : "h-full rounded-full bg-rose-500 transition-[width] duration-300"
                        bar.style.display = fraction === null ? "none" : ""
                        caption.className = done
                            ? "text-sm text-emerald-400"
                            : "text-sm text-zinc-400"
                        caption.textContent = done ? run.message : phaseCaption(run.phase)
                        return runArea
                    },
                ),
            )
        },
    )
}

import van from "vanjs-core"

import { Link } from "./Link.ts"
import clsx from "./clsx.ts"
import { navigate, parseRoute } from "./router.ts"

const { div, form, input, nav, span } = van.tags

type PageItem =
    | { kind: "page"; page: number }
    // A run of pages too far from the current one to render as buttons; the
    // min/max is the range this gap covers (used as a hint for the jump input).
    | { kind: "gap"; min: number; max: number }

function pageItems(current: number, total: number): PageItem[] {
    if (total <= 7) {
        return Array.from({ length: total }, (_, i) => ({ kind: "page" as const, page: i + 1 }))
    }
    const items: PageItem[] = [{ kind: "page", page: 1 }]
    const left = Math.max(2, current - 1)
    const right = Math.min(total - 1, current + 1)
    if (left > 2) items.push({ kind: "gap", min: 2, max: left - 1 })
    for (let page = left; page <= right; page++) items.push({ kind: "page", page })
    if (right < total - 1) items.push({ kind: "gap", min: right + 1, max: total - 1 })
    items.push({ kind: "page", page: total })
    return items
}

// Shared sizing/centering. inline-flex so min-w-9 and centering apply to the
// inline <a>/<span> (a bare button centers its content by default).
const ITEM_CLASS =
    "inline-flex min-w-9 items-center justify-center rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors"

interface PageItemProps {
    href: string
    label: string
    title?: string
    disabled?: boolean
    active?: boolean
}

// A page renders as a real Link when it's a navigable target. The current page
// is a non-link with aria-current (you're already there), and out-of-range
// targets are a muted, non-interactive span (there is no <a disabled>).
function PageItem({ href, label, title = label, disabled = false, active = false }: PageItemProps) {
    if (disabled) {
        return span({ title, class: clsx(ITEM_CLASS, "cursor-not-allowed text-zinc-600") }, label)
    }
    if (active) {
        return span(
            {
                "aria-current": "page",
                title,
                class: clsx(ITEM_CLASS, "bg-rose-500 font-medium text-white"),
            },
            label,
        )
    }
    return Link(
        {
            href,
            title,
            class: clsx(ITEM_CLASS, "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"),
        },
        label,
    )
}

interface PageJumpProps {
    // The range of pages the gap this input stands in for covers. Suggested
    // in the title; the input itself accepts any valid page.
    min: number
    max: number
    totalPages: number
    pageHref: (page: number) => string
}

// Stands in for a collapsed range of pages: type a page number and press
// Enter to jump there. Navigates SPA-style when the target is a known route
// (mirroring Link), and falls back to a full navigation otherwise.
function PageJump({ min, max, totalPages, pageHref }: PageJumpProps) {
    return form(
        {
            class: "flex items-center",
            onsubmit: (e: SubmitEvent) => {
                e.preventDefault()
                const el = e.currentTarget as HTMLFormElement
                const raw = Number((el.elements.namedItem("page") as HTMLInputElement).value)
                if (!Number.isFinite(raw)) return
                const page = Math.min(totalPages, Math.max(1, Math.trunc(raw)))
                const href = pageHref(page)
                const next = parseRoute(href)
                if (next.type === "unknown") window.location.assign(href)
                else navigate(next)
            },
        },
        input({
            type: "number",
            name: "page",
            min: 1,
            max: totalPages,
            placeholder: "…",
            title: `Type a page number and press Enter (this gap covers ${min}–${max})`,
            class: "w-7 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-center text-sm tabular-nums placeholder:text-zinc-600 hover:border-zinc-700 hover:bg-zinc-900 focus:border-rose-500 focus:bg-zinc-900 focus:outline-none focus:w-14 transition-all",
        }),
    )
}

export interface PaginationProps {
    currentPage: number
    totalPages: number
    // The URL for a given page. Being a real href is what lets middle-click /
    // ⌘-click open a page in a new tab.
    pageHref: (page: number) => string
}

// Presentational: the caller computes the current and total page from its own
// state and page size, and supplies the per-page URL.
export function Pagination({ currentPage, totalPages, pageHref }: PaginationProps) {
    if (totalPages <= 1) return div()

    return nav(
        { class: clsx("mt-10 flex justify-center pb-4"), "aria-label": "Pagination" },
        div(
            { class: clsx("flex flex-wrap items-center justify-center gap-1.5") },
            PageItem({
                href: pageHref(1),
                label: "«",
                title: "First page",
                disabled: currentPage <= 1,
            }),
            PageItem({
                href: pageHref(currentPage - 1),
                label: "‹",
                title: "Previous page",
                disabled: currentPage <= 1,
            }),
            ...pageItems(currentPage, totalPages).map((item) =>
                item.kind === "gap"
                    ? PageJump({
                          min: item.min,
                          max: item.max,
                          totalPages,
                          pageHref,
                      })
                    : PageItem({
                          href: pageHref(item.page),
                          label: String(item.page),
                          title: `Page ${item.page}`,
                          active: item.page === currentPage,
                      }),
            ),
            PageItem({
                href: pageHref(currentPage + 1),
                label: "›",
                title: "Next page",
                disabled: currentPage >= totalPages,
            }),
            PageItem({
                href: pageHref(totalPages),
                label: "»",
                title: "Last page",
                disabled: currentPage >= totalPages,
            }),
        ),
    )
}

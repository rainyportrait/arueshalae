import van from "vanjs-core"

import { Link } from "./Link.ts"
import clsx from "./clsx.ts"
import { type Route, navigate, routeToUrl } from "./router.ts"

const { button, div, form, input, nav, span } = van.tags

// Shared sizing/centering. inline-flex so min-w-9 and centering apply to the
// inline <a>/<span> (a bare button centers its content by default).
const ITEM_CLASS =
    "inline-flex min-w-9 items-center justify-center rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors"

// Width budget of the fixed chrome items (« ‹ › » …) in px: they hold a single
// glyph, so they always sit at the min-w-9 floor, plus the 6px flex gap.
const FIXED_ITEM_WIDTH = 42
const FIXED_ITEMS = 5

// The window of page buttons shown around the current page, sized to fill the
// container. Buttons get no reserved space outside the window — « and » cover
// first/last, the "…" popover covers arbitrary jumps.
function windowForWidth(container: number, item: number): number {
    return Math.max(1, Math.floor((container - FIXED_ITEMS * FIXED_ITEM_WIDTH) / (item + 6)))
}

function windowPages(current: number, total: number, capacity: number): number[] {
    const count = Math.min(Math.max(capacity, 1), total)
    if (count >= total) return Array.from({ length: total }, (_, i) => i + 1)
    const start = Math.min(Math.max(current - Math.floor(count / 2), 1), total - count + 1)
    return Array.from({ length: count }, (_, i) => start + i)
}

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
    totalPages: number
    routeForPage: (page: number) => Route
}

// The "…" button: opens a small popover with a number input for jumping to
// any page. A document-level click listener (attached only while open) closes
// it on outside clicks; it removes itself once the node leaves the document,
// so an unmount while open doesn't leak the listener.
function PageJump({ totalPages, routeForPage }: PageJumpProps) {
    const open = van.state(false)
    const field = input({
        type: "number",
        min: 1,
        max: totalPages,
        title: `Page (1–${totalPages})`,
        class: "w-16 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-center text-sm tabular-nums focus:border-rose-500 focus:outline-none",
        onkeydown: (e: KeyboardEvent) => {
            if (e.key === "Escape") open.val = false
        },
    })
    const pop = div(
        {
            class: "absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-lg",
            onclick: (e: MouseEvent) => e.stopPropagation(),
        },
        form(
            {
                class: "flex items-center gap-2",
                onsubmit: (e: SubmitEvent) => {
                    e.preventDefault()
                    const raw = Number(field.value)
                    if (!Number.isFinite(raw)) return
                    const page = Math.min(totalPages, Math.max(1, Math.trunc(raw)))
                    open.val = false
                    navigate(routeForPage(page))
                },
            },
            field,
            button(
                {
                    type: "submit",
                    class: "rounded-lg bg-rose-500 px-2.5 py-1 text-sm font-medium text-white transition-colors hover:bg-rose-400",
                },
                "Go",
            ),
        ),
    )
    const btn = button(
        {
            "aria-haspopup": "dialog",
            title: "Go to page",
            class: clsx(ITEM_CLASS, "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"),
            onclick: (e: MouseEvent) => {
                e.stopPropagation()
                open.val = !open.val
            },
        },
        "…",
    )
    const node = div({ class: "relative inline-flex" }, btn, pop)
    const onDocClick = () => {
        if (!node.isConnected) {
            document.removeEventListener("click", onDocClick)
            return
        }
        open.val = false
    }
    let tracking = false
    return () => {
        const isOpen = open.val
        if (isOpen && !tracking) {
            document.addEventListener("click", onDocClick)
            tracking = true
        }
        if (!isOpen && tracking) {
            document.removeEventListener("click", onDocClick)
            tracking = false
        }
        pop.classList.toggle("hidden", !isOpen)
        btn.setAttribute("aria-expanded", String(isOpen))
        if (isOpen) {
            field.value = ""
            field.focus()
        }
        return node
    }
}

export interface PaginationProps {
    currentPage: number
    totalPages: number
    // The route for a given page; the per-page href is derived from it (a
    // real href is what lets middle-click / ⌘-click open a page in a new
    // tab). The jump input navigates the route directly.
    routeForPage: (page: number) => Route
}

// Presentational: the caller computes the current and total page from its own
// state and page size, and supplies the per-page route.
//
// The window size follows the container width and the actual button width.
// The nav is full width, so a ResizeObserver on it reports the container; a
// hidden probe button (same classes, labeled with the widest page number) is
// measured for the item width — button widths grow with digit count, so a
// constant doesn't work. Both land in one state value.
//
// The items row is a live child of the stable nav element: van replaces it
// whenever the measured widths change (and once more after insertion, when
// the first real measurement corrects the estimates). The observer disconnects
// when its nav leaves the document (page navigation), so no dead observers
// accumulate.
export function Pagination({ currentPage, totalPages, routeForPage }: PaginationProps) {
    if (totalPages <= 1) return div()
    const pageHref = (page: number) => routeToUrl(routeForPage(page))

    // Estimates for the first frame; the initial observer callback corrects
    // both right after insertion.
    const metrics = van.state<{ container: number; item: number }>({ container: 960, item: 36 })

    const probe = span(
        {
            class: ITEM_CLASS,
            style: "position:absolute; visibility:hidden; pointer-events:none",
        },
        String(totalPages),
    )
    const itemsRow = () => {
        const { container, item } = metrics.val
        return div(
            { class: "flex flex-wrap items-center justify-center gap-1.5" },
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
            ...windowPages(currentPage, totalPages, windowForWidth(container, item)).map((page) =>
                PageItem({
                    href: pageHref(page),
                    label: String(page),
                    title: `Page ${page}`,
                    active: page === currentPage,
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
            PageJump({ totalPages, routeForPage }),
        )
    }
    const el = nav(
        {
            class: clsx("relative mt-10 flex w-full justify-center pb-4"),
            "aria-label": "Pagination",
        },
        probe,
        itemsRow,
    )
    const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        const target = entry.target as HTMLElement
        if (!target.isConnected) {
            // The nav was swapped out; stop observing the dead node.
            observer.disconnect()
            return
        }
        const newWidth = entry.contentRect.width
        if (newWidth <= 0) return
        // The 2px slack keeps fractional-width churn out of the state.
        if (Math.abs(newWidth - metrics.val.container) > 2) {
            metrics.val = { container: newWidth, item: probe.offsetWidth }
        }
    })
    observer.observe(el)
    return el
}

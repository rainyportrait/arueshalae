import van from "vanjs-core"

import { Link } from "./Link.ts"
import clsx from "./clsx.ts"
import { routeToUrl } from "./router.ts"
import { PAGE_SIZE, list, pid, tags } from "./state/list.ts"

const { div, nav, span } = van.tags

type PageItem = number | "ellipsis"

function pageItems(current: number, total: number): PageItem[] {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
    const items: PageItem[] = [1]
    const left = Math.max(2, current - 1)
    const right = Math.min(total - 1, current + 1)
    if (left > 2) items.push("ellipsis")
    for (let page = left; page <= right; page++) items.push(page)
    if (right < total - 1) items.push("ellipsis")
    items.push(total)
    return items
}

// The postlist URL for a given page, carrying the current tags. Being a real
// href is what lets middle-click / ⌘-click open a page in a new tab.
function pageHref(page: number): string {
    return routeToUrl({ type: "postlist", tags: tags.val, pid: (page - 1) * PAGE_SIZE })
}

// Shared sizing/centering. inline-flex so min-w-9 and centering apply to the
// inline <a>/<span> (a bare button centers its content by default).
const ITEM_CLASS =
    "inline-flex min-w-9 items-center justify-center rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors"

interface PageItemProps {
    page: number
    label: string
    title?: string
    disabled?: boolean
    active?: boolean
}

// A page renders as a real Link when it's a navigable target. The current page
// is a non-link with aria-current (you're already there), and out-of-range
// targets are a muted, non-interactive span (there is no <a disabled>).
function PageItem({ page, label, title = label, disabled = false, active = false }: PageItemProps) {
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
            href: pageHref(page),
            title,
            class: clsx(ITEM_CLASS, "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"),
        },
        label,
    )
}

export function Pagination() {
    return nav({ class: "mt-10 flex justify-center pb-4", "aria-label": "Pagination" }, () => {
        const state = list.val
        const currentPage = Math.floor(pid.val / PAGE_SIZE) + 1
        const totalPages =
            state.status === "ready"
                ? Math.max(1, Math.round(state.lastPagePID / PAGE_SIZE) + 1)
                : 1

        if (totalPages <= 1) return div()

        return div(
            { class: "flex flex-wrap items-center justify-center gap-1.5" },
            PageItem({
                page: 1,
                label: "«",
                title: "First page",
                disabled: currentPage <= 1,
            }),
            PageItem({
                page: currentPage - 1,
                label: "‹",
                title: "Previous page",
                disabled: currentPage <= 1,
            }),
            ...pageItems(currentPage, totalPages).map((item) =>
                item === "ellipsis"
                    ? span({ class: "px-1 text-zinc-600" }, "…")
                    : PageItem({
                          page: item,
                          label: String(item),
                          title: `Page ${item}`,
                          active: item === currentPage,
                      }),
            ),
            PageItem({
                page: currentPage + 1,
                label: "›",
                title: "Next page",
                disabled: currentPage >= totalPages,
            }),
            PageItem({
                page: totalPages,
                label: "»",
                title: "Last page",
                disabled: currentPage >= totalPages,
            }),
        )
    })
}

import van from "vanjs-core/src/van"

import clsx from "./clsx"
import { PAGE_SIZE, goToPage, list, pid } from "./state"

const { button, div, nav, span } = van.tags

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

interface PageButtonProps {
    label: string
    title?: string
    disabled?: boolean
    active?: boolean
    onGo?: () => void
}

function PageButton({
    label,
    title = label,
    disabled = false,
    active = false,
    onGo = () => {},
}: PageButtonProps) {
    return button(
        {
            disabled,
            title,
            onclick: onGo,
            class: clsx(
                "min-w-9 rounded-lg px-3 py-1.5 text-sm tabular-nums transition-colors",
                disabled
                    ? "cursor-not-allowed text-zinc-600"
                    : active
                      ? "bg-rose-500 font-medium text-white"
                      : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100",
            ),
        },
        label,
    )
}

export function Pagination() {
    return nav({ class: "mt-10 flex justify-center pb-4", "aria-label": "Pagination" }, () => {
        const state = list.val
        const currentPid = pid.val ?? 0
        const currentPage = Math.floor(currentPid / PAGE_SIZE) + 1
        const totalPages =
            state.status === "ready"
                ? Math.max(1, Math.round(state.lastPagePID / PAGE_SIZE) + 1)
                : 1

        if (totalPages <= 1) return div()

        return div(
            { class: "flex flex-wrap items-center justify-center gap-1.5" },
            PageButton({
                label: "«",
                title: "First page",
                disabled: currentPage <= 1,
                onGo: () => goToPage(1),
            }),
            PageButton({
                label: "‹",
                title: "Previous page",
                disabled: currentPage <= 1,
                onGo: () => goToPage(currentPage - 1),
            }),
            ...pageItems(currentPage, totalPages).map((item) =>
                item === "ellipsis"
                    ? span({ class: "px-1 text-zinc-600" }, "…")
                    : PageButton({
                          label: String(item),
                          title: `Page ${item}`,
                          active: item === currentPage,
                          onGo: () => goToPage(item),
                      }),
            ),
            PageButton({
                label: "›",
                title: "Next page",
                disabled: currentPage >= totalPages,
                onGo: () => goToPage(currentPage + 1),
            }),
            PageButton({
                label: "»",
                title: "Last page",
                disabled: currentPage >= totalPages,
                onGo: () => goToPage(totalPages),
            }),
        )
    })
}

import van from "vanjs-core"
import { setSearch } from "./FavoritesSearch"

const { button, div, ul, li } = van.tags

const HISTORY_NAME = "arue-history"

interface HistoryEntry {
	term: string
	results: number
}

const history = van.state(loadHistory())

export function addToHistory(entry: HistoryEntry) {
	if (entry.results === 0) return

	const newHistory = [entry, ...history.val.filter((item) => item.term !== entry.term)]
	history.val = newHistory
	localStorage.setItem(HISTORY_NAME, JSON.stringify(newHistory))
}

export function getHistory() {
	return history.val
}

function removeFromHistory(term: string) {
	const newHistory = history.val.filter((item) => item.term !== term)
	history.val = newHistory
	localStorage.setItem(HISTORY_NAME, JSON.stringify(newHistory))
}

export function HistoryButton() {
	return button(
		{ class: "arue-btn", onclick: () => van.add(document.body, HistoryDialog()) },
		() => `History (${history.val.length})`,
	)
}

export function HistoryDialog() {
	const open = van.state(true)

	function escapeListener(e: KeyboardEvent) {
		if (e.key === "Escape") {
			open.val = false
		}
	}
	van.derive(() => {
		if (open.val) {
			document.addEventListener("keydown", escapeListener)
		} else {
			document.removeEventListener("keydown", escapeListener)
		}
	})

	return () =>
		open.val
			? div(
					{
						class: "arue-dialog-backdrop",
						onclick: function (e) {
							if (e.target === this) open.val = false
						},
					},
					div(
						{ class: "arue-dialog" },
						div(
							{ class: "arue-dialog-header" },
							div(),
							div({ class: "arue-dialog-title" }, "History"),
							div(button({ class: "arue-btn", onclick: () => (open.val = false) }, "X")),
						),
						div(
							{ class: "arue-dialog-content" },
							ul(
								{ class: "arue-history-list" },
								history.val.map((item) =>
									li(
										{ class: "arue-history-list-item" },
										div(
											{ class: "arue-history-list-term" },
											`${cleanTerm(item.term)} (${item.results})`,
										),
										div(
											{ class: "arue-history-list-buttons" },
											button(
												{
													class: "arue-btn",
													onclick: () => {
														setSearch(item.term)
														open.val = false
													},
												},
												"Search",
											),
											button(
												{ class: "arue-btn", onclick: () => removeFromHistory(item.term) },
												"X",
											),
										),
									),
								),
							),
						),
					),
				)
			: null
}

function cleanTerm(term: string): string {
	return term
		.split(" ")
		.map((term) => term.trim())
		.filter((term) => term)
		.join(" ")
}

function loadHistory(): HistoryEntry[] {
	try {
		const history = JSON.parse(localStorage.getItem(HISTORY_NAME)!)
		if (!history) throw new Error("no history found")
		if (!Array.isArray(history)) throw new Error("invalid history found")
		return history
	} catch {
		localStorage.setItem(HISTORY_NAME, "[]")
		return []
	}
}

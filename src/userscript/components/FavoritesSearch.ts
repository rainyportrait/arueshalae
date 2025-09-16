import van from "vanjs-core"
import { AutoCompleteSuggestion, getAutocompleteSuggestions, searchFavorites } from "../network"
import { FavoritesSearchResult } from "./FavoritesSearchResult"

const { span, ul, li, form, input, button } = van.tags

const HISTORY_NAME = "arue-history"

export function FavoritesSearch() {
	const inputActive = van.state(false)
	const suggestions = van.state<AutoCompleteSuggestion[]>([])
	const activeIndex = van.state<number>(-1) // -1 means "no selection"
	const search = van.state<string>(getHistory()[0] ?? "")

	;(async () => {
		const newSuggestions = await getAutocompleteSuggestions(getLastWord(search.val))
		suggestions.val = newSuggestions
		activeIndex.val = -1
	})()

	const fetchSuggestions = debounce(async function (term: string) {
		const newSuggestions = await getAutocompleteSuggestions(term)
		suggestions.val = newSuggestions
		activeIndex.val = -1
	}, 250)

	const replaceTerm = async function (newTerm: string) {
		const terms = search.val.split(" ")
		terms.pop()
		terms.push(newTerm)
		search.val = terms.join(" ") + " "

		const newSuggestions = await getAutocompleteSuggestions("")
		suggestions.val = newSuggestions
		activeIndex.val = -1
	}

	const moveSelection = (delta: number) => {
		const list = suggestions.val
		if (!list.length) return
		const next = (activeIndex.val + delta + list.length) % list.length
		activeIndex.val = next
		inputActive.val = true
	}

	return form(
		{
			class: "arue-search-form",
			onsubmit: async (e) => {
				e.preventDefault()
				e.stopPropagation()

				const term = (e.target as HTMLFormElement & { search: HTMLInputElement }).search.value.trim()
				const data = await searchFavorites(term)
				van.add(document.body, FavoritesSearchResult(term, data))
				addToHistory(term)
				inputActive.val = false
				activeIndex.val = -1
			},
		},
		input({
			class: "arue-search",
			type: "text",
			placeholder: "Search favorites",
			name: "search",
			autocomplete: "off",
			spellcheck: false,
			autocapitalize: "off",
			value: search,
			onfocus: () => {
				inputActive.val = true
			},
			oninput: (e: Event) => {
				inputActive.val = true
				const el = e.target as HTMLInputElement
				search.val = el.value

				fetchSuggestions(getLastWord(search.val))
			},
			onkeydown: (e: KeyboardEvent) => {
				const key = e.key
				if (key === "Escape") {
					inputActive.val = false
					activeIndex.val = -1
					return
				}

				if (!suggestions.val.length) return

				switch (key) {
					case "ArrowDown": {
						e.preventDefault()
						moveSelection(1)
						break
					}
					case "ArrowUp": {
						e.preventDefault()
						moveSelection(-1)
						break
					}
					case "Enter":
					case "Tab": {
						if (activeIndex.val >= 0) {
							e.preventDefault()
							const s = suggestions.val[activeIndex.val]
							if (s) replaceTerm(s.name)
						}
						break
					}
				}
			},
		}),
		button({ class: "arue-btn" }, "Search"),
		() =>
			inputActive.val && suggestions.val.length > 0
				? ul(
						{
							class: "arue-autocomplete",
							role: "listbox",
						},
						suggestions.val.map((suggestion, index) =>
							li(
								{
									class:
										`arue-search-suggestion-line arue-tag-${suggestion.kind}` +
										(index === activeIndex.val ? " is-active" : ""),
									role: "option",
									"aria-selected": index === activeIndex.val ? "true" : "false",
									onmousedown: (e: MouseEvent) => e.preventDefault(),
									onclick: (e) => {
										e.preventDefault()
										replaceTerm(suggestion.name)
									},
									onmouseenter: () => {
										activeIndex.val = index
									},
									tabIndex: -1,
								},
								span(suggestion.name),
								span(suggestion.uses),
							),
						),
					)
				: "",
	)
}

function addToHistory(term: string) {
	const history = getHistory()
	const newHistory = [term, ...history.filter((item) => item !== term)]
	localStorage.setItem(HISTORY_NAME, JSON.stringify(newHistory))
}

function getHistory(): string[] {
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

function getLastWord(search: string) {
	return search.split(" ").at(-1)!.trim()
}

function debounce<F extends (...args: any[]) => any>(callback: F, wait: number): (...args: Parameters<F>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null

	return function (this: ThisParameterType<F>, ...args: Parameters<F>) {
		if (timeoutId !== null) {
			clearTimeout(timeoutId)
			timeoutId = null
		}

		timeoutId = setTimeout(() => {
			timeoutId = null
			callback.apply(this, args)
		}, wait)
	}
}

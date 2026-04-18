import van from "vanjs-core"

const { input } = van.tags

export function addSearchEnhancements() {
	const form = document.querySelector('form[action="index.php?page=search"]')
	if (!form) return

	van.add(
		form,
		EnhancedSearchButton("Sort by score", "sort:score"),
		EnhancedSearchButton("Score > 50", "score:>50", true),
		EnhancedSearchButton("Score > 150", "score:>150", true),
	)
}

function EnhancedSearchButton(label: string, value: string, halfButton = false) {
	return input({
		type: "submit",
		class: `arue-search-btn${halfButton ? " arue-search-half" : ""}`,
		value: label,
		onclick: () => toggleValue(value),
	})
}

function toggleValue(value: string) {
	const searchInput = document.querySelector('input[name="tags"]')
	if (!searchInput || !(searchInput instanceof HTMLInputElement)) return

	let values = searchInput.value.split(" ")
	const special = value.substring(0, value.indexOf(":"))
	if (special) {
		values = values.filter((v) => !v.startsWith(special))
		values.push(value)
	} else {
		const valueSet = new Set(values)
		if (!valueSet.delete(value)) {
			valueSet.add(value)
		}
		values = Array.from(valueSet)
	}

	searchInput.value = values.join(" ")
}

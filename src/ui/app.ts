import van from "vanjs-core"

const { title, style, div } = van.tags

const pageTitle = van.state("Arueshalae")

function Head() {
	// Use Tailwind CSS from global variable set by build banner
	return [title(() => pageTitle.val), style(TAILWIND_CSS)]
}

function App() {
	return div({ class: "text-lg font-bold" }, "Hello, Arueshalae :)")
}

export function initUI() {
	document.documentElement.innerHTML = ""
	van.add(document.head, Head())
	van.add(document.body, App())
}

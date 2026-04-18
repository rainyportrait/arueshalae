import type { VNode } from "preact"
import { render } from "preact"

// Page title state - managed directly for simplicity
let pageTitle = "Arueshalae"

import { RouterView } from "./router"
import { Link } from "wouter-preact"

function App(): VNode {
	return (
		<>
			<div class="px-4 pt-2 text-blue-500 hover:text-blue-800 visited:text-violet-500">
				<Link to="/" class="text-xl">
					Arueshalae
				</Link>
			</div>
			<RouterView></RouterView>
		</>
	)
}

export function initUI(): () => void {
	// Set up head elements (vanilla JS - Preact doesn't render to head well)
	document.head.innerHTML = ""
	const titleEl = document.createElement("title")
	titleEl.textContent = pageTitle
	document.head.appendChild(titleEl)

	const viewportEl = document.createElement("meta")
	viewportEl.name = "viewport"
	viewportEl.content = "width=device-width, initial-scale=1.0"
	document.head.appendChild(viewportEl)

	const styleEl = document.createElement("style")
	styleEl.textContent = TAILWIND_CSS
	document.head.appendChild(styleEl)

	// Create a container for Preact mounting
	// Emptying the body is done on purpose. Don't remove it.
	document.body.innerHTML = ""
	const container = document.createElement("div")
	container.id = "arueshalae-root"
	document.body.prepend(container)

	// Use Preact's render API
	render(<App />, container)

	// Return cleanup function
	return () => {
		// @ts-ignore - See above
		render(null, container)
		document.head.innerHTML = ""
		document.body.innerHTML = ""
	}
}

import { Router, Route, Redirect, Switch } from "wouter-preact"
import { useHashLocation } from "wouter-preact/use-hash-location"
import type { VNode } from "preact"
import { Posts } from "./posts"

// Redirect from rule34.xxx URL format to clean base path with hash-based routing
function redirectFromRule34(): void {
	const pathname = location.pathname
	const search = location.search

	// Check if we should redirect (on legacy index.php path)
	if (pathname !== "/index.php") {
		// Already on clean base, no redirect needed
		return
	}

	const params = new URLSearchParams(search)
	const page = params.get("page")
	const site = params.get("s")
	const tags = params.get("tags")
	const id = params.get("id")

	// Build the hash route from query params (without leading /, wouter adds #/)
	let hashRoute = ""
	if (page === "post") {
		if (site === "list") {
			hashRoute = tags ? `posts?tags=${tags}` : "posts"
		} else if (site === "view" && id) {
			hashRoute = `post/${id}`
		}
	} else if (page === "favorites") {
		hashRoute = "favorites"
	} else if (page === "pool") {
		hashRoute = "pool"
	}

	// Build destination: base path + hash with leading #/ (wouter format: #/path)
	const destination = `/${hashRoute ? `#/${hashRoute}` : ""}`

	// Redirect to hash-based route
	history.replaceState(null, ``, destination)
}

// Call redirect on first load
if (typeof window !== "undefined") {
	redirectFromRule34()
}

export function RouterView(): VNode {
	return (
		<Router hook={useHashLocation}>
			<Switch>
				{/* Regex pattern allows query params - ? makes trailing ? optional */}
				<Route path={/\/posts(\?.*)?/} component={Posts} />
				{/* Default 404 route */}
				<Route>
					<div class="p-4">
						<h1 class="text-2xl font-bold">404 - Not Found</h1>
						<p>Page not found</p>
					</div>
				</Route>
			</Switch>
		</Router>
	)
}

export { Route, Redirect }

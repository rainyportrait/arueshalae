import { Route, Redirect, Switch } from "wouter-preact"
import { useLocation } from "wouter-preact"
import { navigate } from "wouter-preact/use-browser-location"
import type { VNode } from "preact"
import { Posts } from "./Posts"
import { Post } from "./Post"

// Link component for navigation
export function Link({ href, children, className }: { href: string; children: VNode; className?: string }): VNode {
	const [, navigate] = useLocation()
	return (
		<a
			href={href}
			class={className}
			onClick={(e) => {
				e.preventDefault()
				navigate(href)
			}}
		>
			{children}
		</a>
	)
}

let redirected = false

// Redirect from rule34.xxx URL format to clean base path
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
	const query = params.get("tags")
	const id = params.get("id")
	const pid = params.get("pid") ?? "0"

	// Build the route from query params (without leading /, wouter adds #/)
	let newRoute = ""
	if (page === "post") {
		if (site === "list") {
			newRoute = `posts?${query ? `query=${query}` : ""}&pid=${pid}`
		} else if (site === "view" && id) {
			newRoute = `post/${id}`
		}
	} else if (page === "favorites") {
		newRoute = "favorites"
	} else if (page === "pool") {
		newRoute = "pool"
	}

	// Build destination: newRoute  includes query params (e.g., "posts?tags=all")
	if (newRoute) {
		navigate(newRoute, { replace: true })
	} else {
		navigate("/", { replace: true })
	}
}

// Call redirect on first load
if (typeof window !== "undefined") {
	if (!redirected) redirectFromRule34()
	redirected = true
}

export function RouterView(): VNode {
	return (
		<Switch>
			<Route path="/post/:id">
				<Post />
			</Route>
			<Route path="posts">
				<Posts />
			</Route>
			{/* Default 404 route */}
			<Route>
				<div class="p-4">
					<h1 class="text-2xl font-bold">404 - Not Found</h1>
					<p>Page not found</p>
				</div>
			</Route>
		</Switch>
	)
}

export { Route, Redirect, navigate }

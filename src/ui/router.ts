// Simple hash-based router for the userscript

export interface Route {
	hash: string
	params: URLSearchParams
}

export class HashRouter {
	private currentRoute: Route | null = null
	private callbacks: ((route: Route) => void)[] = []

	constructor() {
		this.redirectToUserscript()
		this.setupListeners()
	}

	// Redirect from rule34.xxx URL format to clean base path with hash-based routing
	redirectToUserscript(): void {
		const pathname = location.pathname
		const search = location.search

		// Check if we should redirect (not already on our clean base)
		const shouldRedirect = pathname === "/index.php" || pathname !== "/"

		if (!shouldRedirect) {
			// Already on clean base, just handle initial hash if present
			if (location.hash && !this.currentRoute) {
				this.handleRouteChange()
			}
			return
		}

		const params = new URLSearchParams(search)
		const page = params.get("page")
		const site = params.get("s")
		const tags = params.get("tags")
		const id = params.get("id")

		// Build the hash route from query params
		let hash = "/"
		if (page === "post") {
			if (site === "list") {
				hash = tags ? `/posts?tags=${tags}` : "/posts"
			} else if (site === "view" && id) {
				hash = `/post/${id}`
			}
		} else if (page === "favorites") {
			hash = "/favorites"
		} else if (page === "pool") {
			hash = "/pool"
		}

		// Build destination: pathname / + hash + original search (if any)
		const destination = `${hash}${params.toString() ? `?${params.toString()}` : ""}`

		// Redirect to clean base with our hash route
		history.replaceState(null, "", destination)
	}

	// Subscribe to route changes
	onChange(callback: (route: Route) => void): () => void {
		this.callbacks.push(callback)
		// Trigger immediately with current route (hash or pathname-based)
		const current = this.currentRoute || this.getCurrentRoute()
		if (current) {
			callback(current)
		}

		// Return unsubscribe function
		return () => {
			this.callbacks = this.callbacks.filter((cb) => cb !== callback)
		}
	}

	private setupListeners(): void {
		window.addEventListener("hashchange", () => this.handleRouteChange())
		// Handle initial load if hash already exists
		if (location.hash) {
			this.handleRouteChange()
		}
	}

	private handleRouteChange(): void {
		// Support both hash-based (#/route) and pathname-based (/route) navigation
		// This allows smooth transition from the initial redirect
		let hash: string
		let params: URLSearchParams

		if (location.hash) {
			hash = location.hash
			params = new URLSearchParams(hash.split("?")[1] || "")
		} else {
			// Fall back to pathname for initial navigation
			const pathname = location.pathname
			hash = pathname === "/" ? "/" : pathname
			params = new URLSearchParams(location.search)
		}

		this.currentRoute = { hash, params }
		this.callbacks.forEach((cb) => cb(this.currentRoute!))
	}

	navigate(pathname: string, options?: {
		search?: string | URLSearchParams | Record<string, string | number | boolean | null | undefined>
		replace?: boolean
	}): void {
		const searchParam = options?.search
		const search = typeof searchParam === "string"
			? searchParam
			: searchParam instanceof URLSearchParams
				? searchParam.toString()
				: searchParam
					? new URLSearchParams(Object.entries(searchParam).filter(([, v]) => v != null).toString())
						.toString()
					: ""

		const url = search ? `${pathname}?${search}` : pathname

		if (options?.replace) {
			history.replaceState(null, "", url)
		} else {
			window.history.pushState(null, "", url)
		}
		// Trigger route change
		this.handleRouteChange()
	}

	getCurrentRoute(): Route | null {
		return this.currentRoute
	}
}

export const router = new HashRouter()

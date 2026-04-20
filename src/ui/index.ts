import { initUI } from "./app"
import { isChallengePage, isInIframe, signalCaptchaResolved } from "./captcha/detection"

// App initialization
function runApp(): void {
	const search = new URLSearchParams(location.search)
	const page = search.get("page")

	// Handle post-related pages
	if (page === "post") {
		const site = search.get("s")
		const id = search.get("id")
		if (site === "list") {
			// Post list - valid context, nothing to do
			return
		}
		if (site === "view" && id) {
			const postId = Number.parseInt(id, 10)
			if (Number.isNaN(postId)) return
			// Post view - valid context, nothing to do
			return
		}
	}

	// Default: run the app
	initUI()
}

// Main initialization flow
function main() {
	if (isChallengePage()) {
		// Cloudflare challenge page - go dormant
	} else if (isInIframe()) {
		// Challenge cleared in iframe - signal parent to close modal
		signalCaptchaResolved()
	} else {
		// Normal page context - run full app
		runApp()
	}
}

main()

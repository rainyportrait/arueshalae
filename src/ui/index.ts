import { initUI } from "./app"

/**
 * UI INITIALIZATION FLOW (bundled as userscript):
 *
 * Context detection:
 * 1. If on a Cloudflare challenge page → go dormant (do nothing)
 * 2. If NOT on challenge page and inside an iframe → signal parent to close modal
 * 3. Otherwise → run the full app
 */

// Check if we're on a Cloudflare challenge page
function isChallengePage(): boolean {
	const search = new URLSearchParams(location.search)
	const hash = location.hash
	if (search.has("__cf_chl_rt_tk") || hash.includes("__cf_chl_rt_tk")) {
		return true
	}
	const bodyText = document.body?.textContent ?? ""
	return bodyText.toLowerCase().includes("captcha") || bodyText.toLowerCase().includes("turnstile")
}

// Check if running inside an iframe
function isInIframe(): boolean {
	return window.frameElement !== null || window.top !== window
}

// Signal parent window that captcha was resolved
function signalCaptchaResolved(): void {
	if (window.top) {
		window.top.postMessage("captcha_passed", "*")
	}
	document.body.innerHTML =
		'<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-size:24px;color:white;">Closing...</div>'
}

// Run the normal app logic when not in challenge context or iframe
function runApp(): void {
	const search = new URLSearchParams(location.search)
	const page = search.get("page")

	// Handle favorites page
	if (page === "favorites") {
		initUI()
		return
	}

	// Handle post-related pages - no iframe check needed, already done above
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
if (isChallengePage()) {
	// Cloudflare challenge page - go dormant
} else if (isInIframe()) {
	// Challenge cleared in iframe - signal parent to close modal
	signalCaptchaResolved()
} else {
	// Normal page context - run full app
	runApp()
}

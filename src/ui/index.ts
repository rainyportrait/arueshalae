import { initUI } from "./app"

/**
 * UI INITIALIZATION FLOW (bundled as userscript):
 *
 * This script runs in two possible contexts:
 * 1. Normal page context (iframe === false) - runs full app logic
 * 2. Cloudflare challenge page inside an iframe (challenge === true, iframe === true) - goes dormant
 * 3. After Cloudflare refreshes iframe (challenge === false, iframe === true) - signals parent
 *
 * Every time the script starts, it checks its context and acts accordingly.
 */

// Check if we're on a Cloudflare challenge page
// This is the PRIMARY check that determines if we go dormant or proceed
function isChallengePage(): boolean {
	const hasChallengeToken = location.search.includes("__cf_chl_rt_tk") || location.hash.includes("__cf_chl_rt_tk")
	if (hasChallengeToken) {
		return true
	}
	// Fallback: check body for captcha elements
	const bodyText = document.body?.textContent ?? ""
	return bodyText.toLowerCase().includes("captcha") || bodyText.toLowerCase().includes("turnstile")
}

// Check if running inside an iframe
// This is checked AFTER we know we're NOT on a challenge page
function isInIframe(): boolean {
	// Use both checks: window.frameElement is the most direct
	// window.top !== window is a fallback that's more reliable after page reloads
	return window.frameElement !== null || window.top !== window
}

// Run the normal app logic when not in challenge context
function runApp(): void {
	const search = new URLSearchParams(location.search)
	switch (search.get("page")) {
		case "favorites": {
			initUI()
			console.log("[Arueshalae UI] Loaded")
			break
		}
		case "post": {
			const site = search.get("s")
			if (site === "list") {
				// For post list pages, check iframe status first
				if (isInIframe()) {
					// Cloudflare cleared the challenge, send signal to close modal
					console.log("[Arueshalae UI] Challenge cleared - signaling parent to close modal")
					if (window.top) {
						window.top.postMessage("captcha_passed", "*")
					}
					document.body.innerHTML =
						'<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-size:24px;color:white;">Closing...</div>'
					return
				}
				console.log("[Arueshalae UI] Loaded")
				break
			}
			if (site === "view") {
				const id = Number.parseInt(search.get("id") ?? "", 10)
				if (Number.isNaN(id)) break
				console.log("[Arueshalae UI] Loaded")
				break
			}
		}
		default: {
			if (isInIframe()) {
				// Cloudflare cleared the challenge, send signal to close modal
				console.log("[Arueshalae UI] Challenge cleared - signaling parent to close modal")
				if (window.top) {
					window.top.postMessage("captcha_passed", "*")
				}
				document.body.innerHTML =
					'<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-size:24px;color:white;">Closing...</div>'
				return
			}
			initUI()
			console.log("[Arueshalae UI] Loaded")
		}
	}
}

// Check for challenge first - if present, go dormant (do nothing)
// This handles the case where Cloudflare shows us a challenge page
if (isChallengePage()) {
	console.log("[Arueshalae UI] Running on Cloudflare challenge page - going dormant")
	// Script ends here - no further code executes
} else {
	// We're NOT on a challenge page - check if we're in an iframe
	console.log("[Arueshalae UI] NOT on challenge page, checking iframe status...")
	if (isInIframe()) {
		// Cloudflare cleared the challenge, send signal to close modal
		console.log("[Arueshalae UI] Challenge cleared - signaling parent to close modal")
		if (window.top) {
			window.top.postMessage("captcha_passed", "*")
		}
		document.body.innerHTML =
			'<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-size:24px;color:white;">Closing...</div>'
	} else {
		// Normal page context - run the full app
		console.log("[Arueshalae UI] NOT in iframe - running full app")
		runApp()
	}
}

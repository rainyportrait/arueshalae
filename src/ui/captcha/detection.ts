/**
 * Check if we're on a Cloudflare challenge page
 */
export function isChallengePage(): boolean {
	const search = new URLSearchParams(location.search)
	const hash = location.hash
	if (search.has("__cf_chl_rt_tk") || hash.includes("__cf_chl_rt_tk")) {
		return true
	}
	const bodyText = document.body?.textContent ?? ""
	return bodyText.toLowerCase().includes("captcha") || bodyText.toLowerCase().includes("turnstile")
}

/**
 * Check if running inside an iframe
 */
export function isInIframe(): boolean {
	return window.frameElement !== null || window.top !== window
}

/**
 * Signal parent window that captcha was resolved
 */
export function signalCaptchaResolved(): void {
	if (window.top) {
		window.top.postMessage("arueshalae_captcha_solved", "*")
	}
	document.body.innerHTML =
		'<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-size:24px;color:#000;">Closing...</div>'
}

import { useState, useEffect } from "preact/hooks"

// Custom events for captcha handling
interface ShowCaptchaEventDetail {
	url: string
}

// Type declarations for custom events
declare global {
	interface WindowEventMap {
		__showCaptcha: CustomEvent<ShowCaptchaEventDetail>
		__captchaResolved: CustomEvent<{}>
	}
}

export type { ShowCaptchaEventDetail }

// Promise that resolves when captcha is solved
let captchaResolvePromise: Promise<void> | null = null
let captchaResolveCallback: (() => void) | null = null

/**
 * Show captcha modal and wait for user to solve it.
 * Returns existing promise if captcha is already active.
 */
export async function solveCaptcha(url: string): Promise<void> {
	// If captcha already active, return existing promise (network request queueing)
	if (captchaResolvePromise) {
		return captchaResolvePromise
	}

	// Create new promise that resolves when captcha is solved
	captchaResolvePromise = new Promise((resolve) => {
		captchaResolveCallback = resolve
	})

	// Show the modal
	window.dispatchEvent(new CustomEvent<ShowCaptchaEventDetail>("__showCaptcha", { detail: { url }, bubbles: true }))

	// Await resolution
	await captchaResolvePromise
}

/**
 * Called when the user has solved the captcha
 */
function solveCaptchaResolved(): void {
	captchaResolveCallback?.()
	captchaResolveCallback = null
	captchaResolvePromise = null
	window.dispatchEvent(new CustomEvent<{}>("__captchaResolved"))
}

export function useCaptcha() {
	const [captchaUrl, setCaptchaUrl] = useState<string | null>(null)

	useEffect(() => {
		const handleShowCaptcha = (e: CustomEvent<{ url: string }>) => {
			setCaptchaUrl(e.detail?.url || null)
		}

		const handleCaptchaResolved = () => {
			setCaptchaUrl(null)
		}

		window.addEventListener("__showCaptcha", handleShowCaptcha as EventListener)
		window.addEventListener("__captchaResolved", handleCaptchaResolved as EventListener)

		return () => {
			window.removeEventListener("__showCaptcha", handleShowCaptcha as EventListener)
			window.removeEventListener("__captchaResolved", handleCaptchaResolved as EventListener)
		}
	}, [])

	return captchaUrl
}

// Listen for postMessage from the userscript iframe
// When challenge is cleared, the iframe sends "arueshalae_captcha_solved" to the parent
window?.addEventListener("message", (e: MessageEvent) => {
	if (e.data === "arueshalae_captcha_solved") {
		solveCaptchaResolved()
	}
})

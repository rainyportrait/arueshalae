// Captcha hooks and state management

import { useState, useEffect } from "preact/hooks"

// Custom events for captcha handling
interface ShowCaptchaEventDetail {
	url: string
}

interface CaptchaResolvedEventDetail {}

// Type declarations for custom events
declare global {
	interface WindowEventMap {
		__showCaptcha: CustomEvent<ShowCaptchaEventDetail>
		__captchaResolved: CustomEvent<CaptchaResolvedEventDetail>
	}
}

export type { ShowCaptchaEventDetail, CaptchaResolvedEventDetail }

// State: true = captcha is active (waiting for user to complete)
//         false = no captcha is active (either never shown or completed)
let captchaActive = false
let waitingForCaptcha: boolean = false

export function showCaptcha(url: string): void {
	// Guard: prevent duplicate calls
	if (captchaActive) {
		return
	}
	captchaActive = true
	waitingForCaptcha = true
	window.dispatchEvent(new CustomEvent<ShowCaptchaEventDetail>("__showCaptcha", { detail: { url }, bubbles: true }))
}

export function markCaptchaResolved(): void {
	// Guard: silently ignore if captcha was never shown
	if (!captchaActive) {
		return
	}
	captchaActive = false
	waitingForCaptcha = false
	window.dispatchEvent(new CustomEvent<CaptchaResolvedEventDetail>("__captchaResolved"))
}

export function isCaptchaActive(): boolean {
	return captchaActive
}

export function isWaitingForCaptcha(): boolean {
	return waitingForCaptcha
}

export function useCaptcha() {
	const [captchaUrl, setCaptchaUrl] = useState<string | null>(null)

	useEffect(() => {
		const handleShowCaptcha = (e: CustomEvent<{ url: string }>) => {
			setCaptchaUrl(e.detail?.url || null)
		}

		window.addEventListener("__showCaptcha", handleShowCaptcha as EventListener)

		return () => {
			window.removeEventListener("__showCaptcha", handleShowCaptcha as EventListener)
		}
	}, [])

	return { captchaUrl, isWaiting: isWaitingForCaptcha }
}

// Listen for postMessage from the iframe
if (typeof window !== "undefined") {
	window.addEventListener("message", (e: MessageEvent) => {
		if (e.data === "captcha_passed" || e.data === "captcha_resolved" || e.data === "success") {
			markCaptchaResolved()
		}
	})
}

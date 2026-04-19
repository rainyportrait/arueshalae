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
let captchaUrl: string | null = null
let waitingForCaptcha: boolean = false
export let setCaptchaUrlFromHook: (url: string | null) => void = () => {}

let cachedSetCaptchaUrl: (url: string | null) => void = () => {}
let resolvedCallbacks: Array<() => void> = []

const setCaptchaUrlCallback = (url: string | null) => {
	cachedSetCaptchaUrl(url)
}

export function showCaptcha(url: string): void {
	// Guard: prevent duplicate calls
	if (captchaActive) {
		console.log("[hooks] Captcha already active, ignoring duplicate showCaptcha call")
		return
	}
	captchaActive = true
	captchaUrl = url
	waitingForCaptcha = true
	window.dispatchEvent(new CustomEvent<ShowCaptchaEventDetail>("__showCaptcha", { detail: { url }, bubbles: true }))
	// NOTE: No monitoring started - only postMessage from userscript closes the modal
}

export function markCaptchaResolved(): void {
	// Guard: silently ignore if captcha was never shown
	if (!captchaActive) {
		console.log("[hooks] markCaptchaResolved called but captcha was not active")
		return
	}
	captchaActive = false
	waitingForCaptcha = false
	captchaUrl = null
	cachedSetCaptchaUrl(null)
	resolvedCallbacks.forEach((cb) => cb())
	resolvedCallbacks = []
	window.dispatchEvent(new CustomEvent<CaptchaResolvedEventDetail>("__captchaResolved"))
}

export function isCaptchaActive(): boolean {
	return captchaActive
}

export function isWaitingForCaptcha(): boolean {
	return waitingForCaptcha
}

export function cleanupCaptchaState(): void {
	// State is cleaned up by markCaptchaResolved
}

export function onCaptchaResolved(callback: () => void): void {
	resolvedCallbacks.push(callback)
}

export function useCaptcha() {
	const [captchaUrl, setCaptchaUrl] = useState<string | null>(null)

	useEffect(() => {
		const handleShowCaptcha = (e: CustomEvent<{ url: string }>) => {
			console.log("[useCaptcha] Setting captchaUrl to:", e.detail?.url)
			setCaptchaUrl(e.detail?.url || null)
		}

		window.addEventListener("__showCaptcha", handleShowCaptcha as EventListener)
		// Capture the set function so we can call it later from markCaptchaResolved
		cachedSetCaptchaUrl = setCaptchaUrl
		setCaptchaUrlFromHook = setCaptchaUrlCallback

		return () => {
			window.removeEventListener("__showCaptcha", handleShowCaptcha as EventListener)
			cleanupCaptchaState()
		}
	}, [])

	return { captchaUrl, isWaiting: isWaitingForCaptcha }
}

// Listen for postMessage from the iframe (runs after all functions are defined)
if (typeof window !== "undefined") {
	window.addEventListener("message", (e: MessageEvent) => {
		if (e.data === "captcha_passed" || e.data === "captcha_resolved" || e.data === "success") {
			markCaptchaResolved()
		}
	})
}

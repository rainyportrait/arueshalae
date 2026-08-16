import van from "vanjs-core/src/van"

// Heuristics for recognizing a bot-challenge page (Cloudflare / Turnstile).
// The provider puts a token in the challenge URL's query string and the page
// body carries marker words. Refine these for the site's specific provider —
// they are the only site-specific part of the whole pattern.
const CHALLENGE_URL_TOKEN = "__cf_chl_rt_tk"
const CHALLENGE_BODY_MARKERS = ["please enter the captcha to continue to rule34.xxx"]

// The sentinel the solved iframe posts to the top window.
const CAPTCHA_SOLVED = "CAPTCHA_SOLVED"

// The current challenge URL, or null while no modal is showing. The UI renders
// the modal only while this is non-null. This is the reactive stand-in for the
// reference implementation's `__showCaptcha` / `__captchaResolved` events: the
// network layer writes it, the modal reads it.
export const captchaUrl = van.state<string | null>(null)

// Single-flight: one promise gates every request that hits a challenge, so
// concurrent failures queue behind a single modal instead of each opening one.
let captchaPromise: Promise<void> | null = null
let captchaResolve: (() => void) | null = null

// True when the current document is a bot-challenge page.
export function isChallengePage(): boolean {
    const url = unsafeWindow.location.href.toLowerCase()
    const body = (document.body?.textContent ?? "").toLowerCase()
    return (
        url.includes(CHALLENGE_URL_TOKEN) ||
        CHALLENGE_BODY_MARKERS.some((marker) => body.includes(marker))
    )
}

// True when this window is not the top window (i.e. we are inside the modal
// iframe).
export function isInIframe(): boolean {
    return unsafeWindow.top !== unsafeWindow
}

// Tell the top window the challenge was solved.
export function signalCaptchaResolved(): void {
    unsafeWindow.top?.postMessage(CAPTCHA_SOLVED, "*")
}

// Gate a request on the challenge being solved. Returns the shared promise so
// concurrent requests queue behind one modal.
export function solveCaptcha(url: string): Promise<void> {
    if (captchaPromise) return captchaPromise
    captchaPromise = new Promise<void>((resolve) => {
        captchaResolve = resolve
        captchaUrl.val = url
    })
    return captchaPromise
}

// Resolve the pending promise, clear the single-flight state, and close the
// modal.
export function solveCaptchaResolved(): void {
    captchaResolve?.()
    captchaResolve = null
    captchaPromise = null
    captchaUrl.val = null
}

// Bridge the iframe boundary: the solved iframe posts the sentinel to the top
// window, which resolves the pending promise. Set up in the top window only.
export function listenForCaptchaSolved(): void {
    unsafeWindow.addEventListener("message", (event: MessageEvent) => {
        if (event.data === CAPTCHA_SOLVED) solveCaptchaResolved()
    })
}

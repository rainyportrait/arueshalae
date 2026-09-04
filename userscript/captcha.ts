import van from "vanjs-core"

import clsx from "./clsx.ts"

// Heuristics for recognizing a bot-challenge page (Cloudflare / Turnstile).
// The provider puts a token in the challenge URL's query string and the page
// body carries marker words. Refine these for the site's specific provider —
// they are the only site-specific part of the whole pattern.
const CHALLENGE_URL_TOKEN = "__cf_chl_rt_tk"
const CHALLENGE_BODY_MARKERS = ["please enter the captcha to continue to rule34.xxx"]

export function isChallengeBody(body: string): boolean {
    return CHALLENGE_BODY_MARKERS.some((marker) => body.toLowerCase().includes(marker))
}

export function isChallengePage(): boolean {
    const url = location.href.toLowerCase()
    const body = (document.body?.textContent ?? "").toLowerCase()
    return url.includes(CHALLENGE_URL_TOKEN) || isChallengeBody(body)
}

// Style a top-level challenge page while we stay dormant so the challenge
// widget is the focus: dark background, the site's default info hidden, and a
// short instruction above the widget.
export function styleChallengePage(): void {
    // Prevent "flashbang" by bright background.
    document.body.style.background = "#09090b"
    document.body.style.color = "#fff"

    // Hide the default Rule34.xxx info.
    const defaultInfo = document.querySelector<HTMLDivElement>('div:has(img[alt="Rule 34"])')
    if (defaultInfo) defaultInfo.style.display = "none"

    // Remove unnecessary whitespace created by two empty <p> elements.
    document.querySelectorAll("p").forEach((p) => (p.style.display = "none"))

    // Add custom Arueshalae information.
    const { div, h1, p } = van.tags
    document.body.prepend(
        div(
            { style: "padding: 2ch; text-align: center;" },
            h1("Arueshalae"),
            p("Please complete the Captcha below to continue."),
        ),
    )
}

// The sentinel the solved iframe posts to the top window.
const CAPTCHA_SOLVED = "CAPTCHA_SOLVED"

// The current challenge URL, or null while no modal is showing. The UI renders
// the modal only while this is non-null; the network layer writes it, the
// modal reads it.
export const captchaUrl = van.state<string | null>(null)

// Single-flight: one promise gates every request that hits a challenge, so
// concurrent failures queue behind a single modal instead of each opening one.
let captchaPromise: Promise<void> | null = null
let captchaResolve: (() => void) | null = null

export function isInIframe(): boolean {
    return top !== window
}

export function signalCaptchaResolved(): void {
    top?.postMessage(CAPTCHA_SOLVED, "*")
}

export function solveCaptcha(url: string): Promise<void> {
    if (captchaPromise) return captchaPromise
    captchaPromise = new Promise<void>((resolve) => {
        captchaResolve = resolve
        captchaUrl.val = url
    })
    return captchaPromise
}

export function solveCaptchaResolved(): void {
    captchaResolve?.()
    captchaResolve = null
    captchaPromise = null
    captchaUrl.val = null
}

// Bridge the iframe boundary: the solved iframe posts the sentinel to the top
// window, which resolves the pending promise. Set up in the top window only.
export function listenForCaptchaSolved(): void {
    addEventListener("message", (event: MessageEvent) => {
        if (event.data === CAPTCHA_SOLVED) solveCaptchaResolved()
    })
}

// The bot-challenge modal. While a request has hit a challenge, `captchaUrl`
// holds the URL that triggered it; we load it in a same-origin iframe so the
// real challenge widget renders and the user can solve it. The userscript also
// runs inside that iframe and signals the parent once it clears (see
// signalCaptchaResolved), which closes the modal and lets the gated requests
// retry.
export function CaptchaModal() {
    const { div, iframe } = van.tags
    return () => {
        const url = captchaUrl.val
        // van.js drops a live binding whose node isn't connected to the DOM
        // (keepConnected in van.js), so returning null would permanently kill
        // reactivity. Return a zero-footprint comment to stay connected while
        // no challenge is active.
        if (!url) return document.createComment("arue-captcha")
        return div(
            { class: clsx("fixed inset-0 z-50 flex items-center justify-center bg-black/50") },
            iframe({ src: url, class: clsx("m-2 h-75 rounded-lg bg-white") }),
        )
    }
}

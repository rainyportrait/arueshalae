import van from "vanjs-core/src/van"

import { initApp } from "./App"
import {
    isChallengePage,
    isInIframe,
    listenForCaptchaSolved,
    signalCaptchaResolved,
} from "./captcha"

// Three-way boot. The userscript matches the site's origin, so it also runs on
// the challenge page and inside the modal iframe. We handle each case:
//   - Challenge page (top-level or the iframe's first load): stay dormant so we
//     don't clobber the challenge widget the user must interact with.
//   - Not a challenge page but inside an iframe: the challenge was just cleared
//     in our modal iframe; tell the parent so it can retry its requests.
//   - Otherwise: a normal top-level page; run the app.
if (isChallengePage()) {
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
} else if (isInIframe()) {
    signalCaptchaResolved()
} else {
    listenForCaptchaSolved()
    initApp()
}

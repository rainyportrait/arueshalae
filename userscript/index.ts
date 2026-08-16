import { initApp } from "./App.ts"
import {
    isChallengePage,
    isInIframe,
    listenForCaptchaSolved,
    signalCaptchaResolved,
    styleChallengePage,
} from "./captcha.ts"
import { initHead } from "./head.ts"

// Three-way boot. The userscript matches the site's origin, so it also runs on
// the challenge page and inside the modal iframe. We handle each case:
//   - Challenge page (top-level or the iframe's first load): stay dormant so we
//     don't clobber the challenge widget the user must interact with.
//   - Not a challenge page but inside an iframe: the challenge was just cleared
//     in our modal iframe; tell the parent so it can retry its requests.
//   - Otherwise: a normal top-level page; run the app.
if (isChallengePage()) {
    styleChallengePage()
} else if (isInIframe()) {
    signalCaptchaResolved()
} else {
    listenForCaptchaSolved()
    initHead()
    initApp()
}

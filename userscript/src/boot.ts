import { initApp } from "./App.ts"
import {
    isChallengePage,
    isInIframe,
    listenForCaptchaSolved,
    signalCaptchaResolved,
    styleChallengePage,
} from "./captcha.ts"
import { initHead } from "./head.ts"

if (isChallengePage()) {
    styleChallengePage()
} else if (isInIframe()) {
    signalCaptchaResolved()
} else {
    listenForCaptchaSolved()
    initHead()
    initApp()
}

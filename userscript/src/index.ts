import { suppressRule34Player } from "./fluid-player.ts"

// This entrypoint runs before Rule34's scripts. The rest of the app deliberately
// remains a dynamic import: its modules read the parsed document at load time.
suppressRule34Player()

function boot(): void {
    void import("./boot.ts")
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true })
} else {
    boot()
}

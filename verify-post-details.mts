// The source uses extensionless relative imports that Node's ESM resolver
// can't handle, so bundle the module with esbuild (as the real build does) and
// require the result before running the checks.
import { mkdtempSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { build } from "esbuild"
import { parseHTML } from "linkedom"

const dir = mkdtempSync(join(tmpdir(), "arueshalae-pd-"))
const outfile = join(dir, "bundle.cjs")
await build({
    entryPoints: ["userscript/api/post-details.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile,
})
const req = createRequire(import.meta.url)
const { extractPostDetails } = req(outfile) as typeof import("./userscript/api/post-details.ts")

const html = readFileSync("examples/postdetails_image.html", "utf8")
const { document } = parseHTML(html)
const post = extractPostDetails(document, 18072125)

console.log("=== postdetails_image.html ===")
for (const [key, value] of Object.entries(post)) {
    if (key === "tags") continue
    console.log(`  ${key}:`, value)
}
console.log(`  tags: ${post.tags.length}`)

// Sanity checks against the known example values.
const expected: Record<string, unknown> = {
    title: "Cressida 2",
    posted: "2026-07-11 10:28:26",
    poster: "Tree-Bark",
    rating: "Questionable",
    score: 16,
    width: 1000,
    height: 1300,
}
let failures = 0
for (const [key, want] of Object.entries(expected)) {
    const got = post[key as keyof typeof post]
    if (got !== want) {
        console.log(`  MISMATCH ${key}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
        failures++
    }
}
const checks = [
    post.image.includes("images/2875/69470f98afcc308c0958fd996a274722.png"),
    post.sourceHref.includes("deviantart.com"),
    post.posterHref.includes("page=account"),
    post.tags.length > 0,
]
if (checks.some((c) => !c)) {
    console.log("  CHECK FAILED:", checks)
    failures++
}
console.log(failures === 0 ? "  all checks passed" : `  ${failures} check(s) failed`)

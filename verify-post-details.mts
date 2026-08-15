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
type Post = ReturnType<typeof extractPostDetails>

function extract(file: string, id: number): Post {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    return extractPostDetails(document, id)
}

let failures = 0
function check(label: string, ok: boolean, got?: unknown) {
    if (!ok) failures++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)})`}`)
}

// --- image post ---
console.log("=== postdetails_image.html ===")
{
    const post = extract("examples/postdetails_image.html", 18072125)
    console.log(`  media: ${JSON.stringify(post.media)}`)
    console.log(
        `  title=${post.title} posted=${post.posted} poster=${post.poster} rating=${post.rating} score=${post.score} tags=${post.tags.length}`,
    )
    check("media.kind is image", post.media.kind === "image")
    check(
        "image src",
        post.media.kind === "image" &&
            post.media.src.includes("images/2875/69470f98afcc308c0958fd996a274722.png"),
        post.media.src,
    )
    check(
        "dimensions 1000x1300",
        post.media.width === 1000 && post.media.height === 1300,
        `${post.media.width}x${post.media.height}`,
    )
    check("title", post.title === "Cressida 2", post.title)
    check("posted", post.posted === "2026-07-11 10:28:26", post.posted)
    check("poster", post.poster === "Tree-Bark", post.poster)
    check("rating", post.rating === "Questionable", post.rating)
    check("score", post.score === 16, post.score)
    check("sourceHref", post.sourceHref.includes("deviantart.com"), post.sourceHref)
    check("posterHref", post.posterHref.includes("page=account"), post.posterHref)
    check("tags", post.tags.length > 0, post.tags.length)
}

// --- video post ---
console.log("\n=== postdetails_video.html ===")
{
    const post = extract("examples/postdetails_video.html", 14717755)
    console.log(`  media: ${JSON.stringify(post.media)}`)
    console.log(
        `  title="${post.title}" posted=${post.posted} poster=${post.poster} rating=${post.rating} score=${post.score} tags=${post.tags.length}`,
    )
    check("media.kind is video", post.media.kind === "video")
    if (post.media.kind === "video") {
        check(
            "video src (mp4)",
            post.media.src.includes("cccf76f69354516872301f9e3ca1da28.mp4"),
            post.media.src,
        )
        check(
            "poster (jpg)",
            post.media.poster.includes("cccf76f69354516872301f9e3ca1da28.jpg"),
            post.media.poster,
        )
    }
    check(
        "dimensions 700x874",
        post.media.width === 700 && post.media.height === 874,
        `${post.media.width}x${post.media.height}`,
    )
    check("title empty", post.title === "", post.title)
    check("posted", post.posted === "2025-09-06 14:19:21", post.posted)
    check("poster", post.poster === "RazielKain", post.poster)
    check("rating", post.rating === "Explicit", post.rating)
    check("score", post.score === 219, post.score)
    check("sourceHref", post.sourceHref.includes("x.com/francisbrownGG"), post.sourceHref)
    check("posterHref (uname)", post.posterHref.includes("uname=RazielKain"), post.posterHref)
    check("tags", post.tags.length > 0, post.tags.length)
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`)

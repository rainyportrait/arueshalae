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

// --- image post with a sample (displayed image differs from the original) ---
console.log("=== postdetails_image.html ===")
{
    const post = extract("examples/postdetails_image.html", 10793160)
    console.log(`  media: ${JSON.stringify(post.media)}`)
    console.log(
        `  title="${post.title}" posted=${post.posted} poster=${post.poster} rating=${post.rating} score=${post.score} tags=${post.tags.length}`,
    )
    check("media.kind is image", post.media.kind === "image")
    check(
        "image src (sample)",
        post.media.kind === "image" &&
            post.media.src.includes("samples/1153/sample_1c905ed5be3b110e21d6d583754fec59.jpg"),
        post.media.src,
    )
    check(
        "dimensions 2000x2000",
        post.media.width === 2000 && post.media.height === 2000,
        `${post.media.width}x${post.media.height}`,
    )
    check(
        "originalImage (full file)",
        post.media.kind === "image" &&
            post.media.originalImage.includes("images/1153/1c905ed5be3b110e21d6d583754fec59.jpeg"),
        post.media.kind === "image" ? post.media.originalImage : undefined,
    )
    check(
        "sample and original differ",
        post.media.kind === "image" && post.media.originalImage !== post.media.src,
    )
    check("title empty", post.title === "", post.title)
    check("posted", post.posted === "2024-07-28 14:42:09", post.posted)
    check("poster", post.poster === "Crcole331", post.poster)
    check("rating", post.rating === "Explicit", post.rating)
    check("score", post.score === 239, post.score)
    check("sourceHref", post.sourceHref.includes("x.com/Milapone1"), post.sourceHref)
    check("posterHref", post.posterHref.includes("page=account"), post.posterHref)
    check("tags", post.tags.length > 0, post.tags.length)
}

// --- image post without a sample (displayed image is already the original) ---
console.log("\n=== postdetails_no_sample.html ===")
{
    const post = extract("examples/postdetails_no_sample.html", 4636876)
    console.log(`  media: ${JSON.stringify(post.media)}`)
    check("media.kind is image", post.media.kind === "image")
    check(
        "image src",
        post.media.kind === "image" &&
            post.media.src.includes("images/4084/ff4d0b62d416462e4cfa240365f3948d.jpeg"),
        post.media.src,
    )
    check(
        "originalImage equals src (no sample)",
        post.media.kind === "image" && post.media.originalImage === post.media.src,
        post.media.kind === "image" ? post.media.originalImage : undefined,
    )
}

// --- video post (no source listed) ---
console.log("\n=== postdetails_video.html ===")
{
    const post = extract("examples/postdetails_video.html", 17413732)
    console.log(`  media: ${JSON.stringify(post.media)}`)
    console.log(
        `  title="${post.title}" posted=${post.posted} poster=${post.poster} rating=${post.rating} score=${post.score} tags=${post.tags.length}`,
    )
    check("media.kind is video", post.media.kind === "video")
    if (post.media.kind === "video") {
        check(
            "video src (mp4)",
            post.media.src.includes("dced569df123f42de0bdfda9418e56b3.mp4"),
            post.media.src,
        )
        check(
            "poster (jpg)",
            post.media.poster.includes("dced569df123f42de0bdfda9418e56b3.jpg"),
            post.media.poster,
        )
    }
    check(
        "dimensions 1080x1920",
        post.media.width === 1080 && post.media.height === 1920,
        `${post.media.width}x${post.media.height}`,
    )
    check("title empty", post.title === "", post.title)
    check("posted", post.posted === "2026-05-06 15:10:39", post.posted)
    check("poster", post.poster === "Shadowlinkct", post.poster)
    check("rating", post.rating === "Explicit", post.rating)
    check("score", post.score === 235, post.score)
    check("sourceHref empty (no source)", post.sourceHref === "", post.sourceHref)
    check("posterHref (uname)", post.posterHref.includes("uname=Shadowlinkct"), post.posterHref)
    check("tags", post.tags.length > 0, post.tags.length)
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`)

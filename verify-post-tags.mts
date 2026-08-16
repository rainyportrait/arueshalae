// Verify that post thumbnails expose their full tag list (parsed from the
// `alt` text), deduped. Node's native TS type stripping loads the source
// directly (all relative imports carry explicit .ts extensions).
import { readFileSync } from "node:fs"

import { parseHTML } from "linkedom"

import { extractPosts } from "./userscript/api/post-list.ts"

let failures = 0
function check(label: string, ok: boolean, got?: unknown) {
    if (!ok) failures++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)})`}`)
}

for (const file of [
    "examples/postlist.html",
    "examples/favorites.html",
    "examples/userprofile.html",
]) {
    console.log(`\n=== ${file} ===`)
    const { document } = parseHTML(readFileSync(file, "utf8"))
    const posts = extractPosts(document)
    console.log(`  ${posts.length} posts`)
    if (posts.length === 0) continue

    const withTags = posts.filter((p) => p.tags.length > 0)
    check(
        "every post has a non-empty tag list",
        withTags.length === posts.length,
        `${withTags.length}/${posts.length}`,
    )
    // No post should carry a duplicated tag (the site repeats each twice).
    const dupes = posts.filter((p) => new Set(p.tags).size !== p.tags.length)
    check("no post has duplicate tags", dupes.length === 0, dupes.length)
    // Tags are lowercase slugs (no spaces).
    const badTokens = posts
        .flatMap((p) => p.tags)
        .filter((t) => t !== t.toLowerCase() || /\s/u.test(t))
    check("all tokens are lowercase, no spaces", badTokens.length === 0, badTokens.slice(0, 5))

    const first = posts[0]
    console.log(`  first post #${first.id}: ${first.tags.length} tags`)
    console.log(`    ${first.tags.slice(0, 8).join(", ")}…`)
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`)

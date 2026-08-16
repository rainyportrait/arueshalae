// Verify the auth parsing/extraction logic against the sample HTML in
// examples/*.html. The source uses extensionless relative imports that Node's
// ESM resolver can't handle, so bundle the modules with esbuild (as the real
// build does) and require the result before running the checks.
import { mkdtempSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { build } from "esbuild"
import { parseHTML } from "linkedom"

const dir = mkdtempSync(join(tmpdir(), "arueshalae-auth-"))
const req = createRequire(import.meta.url)

async function bundle(entry: string, name: string): Promise<string> {
    const outfile = join(dir, name)
    await build({ entryPoints: [entry], bundle: true, format: "cjs", platform: "node", outfile })
    return outfile
}

const authOut = await bundle("userscript/api/auth.ts", "auth.cjs")
const listOut = await bundle("userscript/api/post-list.ts", "list.cjs")

const auth = req(authOut) as typeof import("./userscript/api/auth.ts")
const list = req(listOut) as typeof import("./userscript/api/post-list.ts")

function doc(file: string) {
    return parseHTML(readFileSync(file, "utf8")).document
}

let failures = 0
function check(label: string, ok: boolean, got?: unknown) {
    if (!ok) failures++
    console.log(`  ${ok ? "ok" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)})`}`)
}

// --- parseUserIdFromAccountHome -------------------------------------------
console.log("=== account-home.html (logged in) ===")
{
    const id = auth.parseUserIdFromAccountHome(doc("examples/account-home.html"))
    check("detects user id 92046", id === 92046, id)
}
console.log("\n=== account-not-logged-in.html (logged out) ===")
{
    const id = auth.parseUserIdFromAccountHome(doc("examples/account-not-logged-in.html"))
    check("no user id (guest)", id === null, id)
}

// --- parseLoginError -------------------------------------------------------
console.log("\n=== auth_with_error.html (failed login) ===")
{
    const msg = auth.parseLoginError(doc("examples/auth_with_error.html"))
    console.log(`  message="${msg}"`)
    check("surfaces the red-bordered message", msg === "Username and/or password is wrong", msg)
}

// --- extractUserProfile ----------------------------------------------------
console.log("\n=== userprofile.html (profile view) ===")
{
    const profile = auth.extractUserProfile(doc("examples/userprofile.html"))
    console.log(
        `  username="${profile.username}" joinDate=${profile.joinDate} posts=${profile.posts} favorites=${profile.favorites}`,
    )
    console.log(
        `  recentFavorites=${profile.recentFavorites.length} recentUploads=${profile.recentUploads.length}`,
    )
    check("username is Krwn", profile.username === "Krwn", profile.username)
    check("joinDate is 2014-11-12", profile.joinDate === "2014-11-12", profile.joinDate)
    check("posts is 34", profile.posts === 34, profile.posts)
    check("favorites is 22255", profile.favorites === 22255, profile.favorites)
    check(
        "recentFavorites has 5",
        profile.recentFavorites.length === 5,
        profile.recentFavorites.length,
    )
    check("recentUploads has 5", profile.recentUploads.length === 5, profile.recentUploads.length)
    // The id comes from the anchor href (not the span id) on the profile page.
    check(
        "recentFavorites[0] id parsed from href",
        profile.recentFavorites[0]?.id === 14705649,
        profile.recentFavorites[0]?.id,
    )
    check(
        "recentUploads[0] id parsed from href",
        profile.recentUploads[0]?.id === 17085790,
        profile.recentUploads[0]?.id,
    )
    check(
        "recentFavorites[0] has thumbnail",
        (profile.recentFavorites[0]?.thumbnail ?? "").includes("wimg.rule34.xxx"),
        profile.recentFavorites[0]?.thumbnail,
    )
}

// --- extractPosts behavior preservation (post list) ------------------------
console.log("\n=== postlist.html (post list, shared helper) ===")
{
    const d = doc("examples/postlist.html")
    const imageList = d.querySelector(".image-list")
    const posts = imageList ? list.extractPosts(imageList) : []
    console.log(`  posts=${posts.length}`)
    check("42 posts", posts.length === 42, posts.length)
    check(
        "all ids are positive",
        posts.every((p) => p.id > 0),
    )
    check("first post id 18455346", posts[0]?.id === 18455346, posts[0]?.id)
    check(
        "first post link carries the id",
        (posts[0]?.link ?? "").includes("id=18455346"),
        posts[0]?.link,
    )
    check("first post has thumbnail", (posts[0]?.thumbnail ?? "").length > 0)
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)

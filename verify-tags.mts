import { readFileSync } from "node:fs"

import { parseHTML } from "linkedom"

import { extractTags } from "./userscript/api/tags.ts"

for (const file of ["examples/postlist.html", "examples/postdetails_image.html"]) {
    const html = readFileSync(file, "utf8")
    const { document } = parseHTML(html)
    const tags = extractTags(document)
    console.log(`\n=== ${file} — ${tags.length} tags ===`)
    const byType = new Map<string, number>()
    for (const t of tags) byType.set(t.type, (byType.get(t.type) ?? 0) + 1)
    console.log("by type:", Object.fromEntries(byType))
    for (const t of tags.slice(0, 6)) {
        console.log(`  [${t.type}] "${t.name}" slug=${t.slug} count=${t.count}`)
    }
    // sanity: no empty names/slugs, counts are numbers
    const bad = tags.filter((t) => !t.name || !t.slug || !Number.isFinite(t.count))
    console.log("  invalid entries:", bad.length)
}

import fs from "node:fs"

import { parseHTML } from "linkedom"

export function fixture(name: string): Document {
    const html = fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")
    return parseHTML(html).document
}

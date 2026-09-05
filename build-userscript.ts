import { exec } from "node:child_process"
import fs from "node:fs/promises"
import process from "node:process"

import { icons } from "@iconify-json/lucide"
import { getIconsCSS } from "@iconify/utils"
import esbuild from "esbuild"

const version = process.argv[2] ?? "dev"

// Lucide icons rendered as CSS masks, mirroring the blog's lib/icons.js. Add an
// icon name here to include it in the generated stylesheet.
const iconNames = [
    "search",
    "user",
    "chevron-down",
    "chevron-left",
    "chevron-right",
    "heart",
    "cog",
    "log-in",
    "log-out",
    "maximize",
    "minimize",
    "plus",
]

function buildIconStyles(): string {
    return getIconsCSS(icons, iconNames, {
        mode: "mask",
        commonSelector: "[icon-name]",
        iconSelector: '[icon-name="{name}"]',
        overrideSelector: '[icon-name][icon-name="{name}"]',
        format: "expanded",
        rules: {
            "vertical-align": "-0.125em",
        },
    })
}

async function buildStyles() {
    return new Promise<void>((resolve, reject) => {
        exec(
            // NOTE: use `--input`/`--output`, NOT `build ... -o`.
            // The `build` subcommand silently drops custom (non-utility) CSS
            // from the entry file, which would break the masonry/skeleton styles.
            "pnpx @tailwindcss/cli --input userscript/styles.css --output target/userscript/tailwind.css",
            (err: Error | null) => {
                if (err) reject(err)
                else resolve()
            },
        )
    })
}

// Global variable to store Tailwind CSS output for the banner
async function runBuild() {
    await fs.mkdir("target", { recursive: true })
    await buildStyles()
    const tailwindCss = await fs.readFile("target/userscript/tailwind.css", "utf8")
    const iconCss = buildIconStyles()
    const tailwindStyles = `${tailwindCss}\n${iconCss}`.replace(/\\/g, "\\\\").replace(/`/g, "\\`")

    await esbuild.build({
        entryPoints: ["userscript/index.ts"],
        bundle: true,
        outfile: "target/userscript/arueshalae.user.js",
        format: "iife",
        platform: "browser",
        target: "es2024",
        minify: false,
        banner: {
            js: `// ==UserScript==
// @name         Arueshalae
// @version      ${version}
// @description  Replaces the default rule34.xxx UI
// @match        https://rule34.xxx/*
// @run-at       document-end
// ==/UserScript==

// Inject Tailwind CSS into global variable
const TAILWIND_CSS = \`${tailwindStyles}\`;
`,
        },
    })
}

async function main() {
    const started = Date.now()
    await runBuild()
    const { size } = await fs.stat("target/userscript/arueshalae.user.js")
    const seconds = (Date.now() - started) / 1000
    console.log(
        `Built target/userscript/arueshalae.user.js (${(size / 1024).toFixed(1)} KB) in ${seconds.toFixed(1)}s`,
    )
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})

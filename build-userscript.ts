import { exec } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { icons } from "@iconify-json/lucide"
import { getIconsCSS } from "@iconify/utils"
import esbuild from "esbuild"

const version = process.argv[2] ?? "dev"

// Lucide icons rendered as CSS masks, mirroring the blog's lib/icons.js. Add an
// icon name here to include it in the generated stylesheet.
const iconNames = ["search"]

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

// esbuild-plugin-inline-import (c) 2020 A Beautiful Site, LLC
// https://github.com/claviska/esbuild-plugin-inline-import/blob/master/LICENSE.md
// TODO: Fix inlineImportPlugin to not print full path into built .js
function inlineImportPlugin() {
    const filter = /^inline:/
    const namespace = "_" + Math.random().toString(36).substring(2, 9)

    return {
        name: "esbuild-inline-plugin",
        setup(build: esbuild.PluginBuild) {
            let alias = Object.entries(build.initialOptions.alias ?? {})
            build.onResolve({ filter }, async (args) => {
                let inputPath = alias.reduce((path, [key, val]) => {
                    return path.replace(key, val)
                }, args.path)

                let filePath = path.resolve(args.resolveDir, inputPath)
                try {
                    await fs.access(filePath)
                } catch {
                    filePath = path.resolve(args.resolveDir, inputPath.replace(filter, ""))
                }

                return {
                    path: filePath,
                    namespace,
                }
            })

            build.onLoad({ filter: /.*/, namespace }, async (args) => {
                let contents = await fs.readFile(args.path, "utf8")

                return {
                    contents,
                    watchFiles: [args.path],
                    loader: "text",
                }
            })
        },
    }
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

    esbuild
        .build({
            entryPoints: ["userscript/index.ts"],
            bundle: true,
            outfile: "target/userscript/arueshalae.user.js",
            format: "iife",
            platform: "browser",
            target: "es2020",
            minify: false,
            banner: {
                js: `// ==UserScript==
// @name         Arueshalae
// @version      ${version}
// @description  Replaces the default rule34.xxx UI
// @match        https://rule34.xxx/*
// @grant        GM.xmlHttpRequest
// @run-at       document-end
// ==/UserScript==

// Inject Tailwind CSS into global variable
const TAILWIND_CSS = \`${tailwindStyles}\`;
`,
            },
            plugins: [inlineImportPlugin()],
        })
        .catch((err) => {
            throw err
        })
}

runBuild()

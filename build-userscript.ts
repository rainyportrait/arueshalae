import esbuild from "esbuild"
import process from "node:process"
import path from "node:path"
import fs from "node:fs/promises"
import { exec } from "node:child_process"

const version = process.argv[2] ?? "dev"

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
		exec("npx postcss src/ui/styles.css -o target/tailwind.css", (err: Error | null) => {
			if (err) reject(err)
			else resolve()
		})
	})
}

// Global variable to store Tailwind CSS output for the banner
async function runBuild() {
	await fs.mkdir("target", { recursive: true })
	await buildStyles()
	const tailwindStyles = await fs.readFile("target/tailwind.css", "utf8")

	esbuild
		.build({
			entryPoints: ["src/ui/index.ts"],
			bundle: true,
			outfile: "target/userscript/arueshalae-ui.user.js",
			format: "iife",
			platform: "browser",
			target: "es2020",
			minify: false,
			jsx: "automatic",
			jsxImportSource: "preact",
			banner: {
				js: `// ==UserScript==
// @name         Arueshalae UI
// @version      ${version}
// @description  Replaces the default rule34.xxx UI
// @match        https://rule34.xxx/*
// @grant        GM.xmlHttpRequest
// @run-at       document-body
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

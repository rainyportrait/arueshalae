import esbuild from "esbuild"
import process from "node:process"
import path from "node:path"
import fs from "node:fs/promises"

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

esbuild
	.build({
		entryPoints: ["src/userscript/index.ts"],
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
// @description  Downloads your rule34.xxx favorites
// @match        https://rule34.xxx/index.php?*
// @grant        GM.xmlHttpRequest
// @run-at       document-idle
// ==/UserScript==`,
		},
		plugins: [inlineImportPlugin()],
	})
	.catch((err) => {
		throw err
	})

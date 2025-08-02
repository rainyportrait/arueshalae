const esbuild = require("esbuild")
const process = require("node:process")
const path = require("path")
const fs = require("fs").promises

const version = process.argv[2]

// esbuild-plugin-inline-import (c) 2020 A Beautiful Site, LLC
// https://github.com/claviska/esbuild-plugin-inline-import/blob/master/LICENSE.md
// TODO: Fix inlineImportPlugin to not print full path into built .js
function inlineImportPlugin(options) {
	const { filter, namespace, transform } = Object.assign(
		{
			filter: /^inline:/,
			namespace: "_" + Math.random().toString(36).substring(2, 9),
		},
		options,
	)

	return {
		name: "esbuild-inline-plugin",
		setup(build) {
			let alias = Object.entries(build.initialOptions.alias ?? {})
			build.onResolve({ filter }, async args => {
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

			build.onLoad({ filter: /.*/, namespace }, async args => {
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
		entryPoints: ["assets/userscript/index.ts"],
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
// @grant        none
// @run-at       document-idle
// @downloadUrl  http://localhost:34343/arueshalae.user.js
// @updateUrl    http://localhost:34343/arueshalae.user.js
// ==/UserScript==
`,
		},
		plugins: [inlineImportPlugin()],
	})
	.catch(err => {
		throw err
	})

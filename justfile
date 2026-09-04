[parallel]
watch-and-serve-userscript: watch-userscript serve-userscript

build-userscript:
	node build-userscript.ts

test:
	pnpm test

watch-userscript:
	watchexec -r -e ts,css,tsx -- just build-userscript

serve-userscript:
	python3 -m http.server 8080 --directory target/userscript

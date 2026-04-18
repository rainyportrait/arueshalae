[parallel]
watch-and-serve-userscript: watch-userscript serve-userscript

build-userscript:
	node build-userscript.ts

tailwind:
	npx postcss src/ui/styles.css -o target/tailwind.css

watch-userscript:
	watchexec -r -e ts,css,tsx -- just build-userscript

serve-userscript:
	python3 -m http.server

watch-and-run-cargo arguments="":
	watchexec -r -e rs,sql -- cargo run -- {{arguments}}

build:
	cargo build -r

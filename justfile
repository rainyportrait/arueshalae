[parallel]
watch-and-serve-userscript: watch-userscript serve-userscript

build-userscript:
  node build-userscript.ts

watch-userscript:
  watchexec -r -e ts,css -- just build-userscript

serve-userscript:
  python3 -m http.server

watch-cargo arguments="":
  watchexec -r -e rs,sql -- cargo run -- {{arguments}}

build:
  cargo build -r

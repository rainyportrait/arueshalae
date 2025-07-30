build-userscript:
  npm install
  node build_userscript.js $(cargo metadata --format-version=1 --no-deps | jq -r '.packages[0].version')

build: build-userscript
  cargo build --release

run arguments="": build-userscript
  cargo run -- {{arguments}}

watch arguments="":
  watchexec -r -e rs,html,css,ts,toml,js -- just run {{arguments}}

default: build

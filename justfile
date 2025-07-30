build-userscript:
  npm install
  node build_userscript.js

build: build-userscript
  cargo build --release

run arguments="": build-userscript
  cargo run -- {{arguments}}

watch arguments="":
  watchexec -r -e rs,html,css,ts -- just run {{arguments}}

default: build

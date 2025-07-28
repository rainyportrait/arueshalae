build-userscript:
  npm install
  node build_userscript.js

build: build-userscript
  cargo build --release

run: build-userscript
  cargo run

watch:
  watchexec -r -e rs,html,css,ts -- just run

default: build

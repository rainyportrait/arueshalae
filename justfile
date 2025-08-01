build:
  cargo build --release

run arguments="":
  cargo run -- {{arguments}}

watch arguments="":
  watchexec -r -e rs,toml,html,css,js,ts -- just run {{arguments}}

default: build

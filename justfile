# Build and dev loop for both halves of the project.

default:
    watchexec -w userscript -e ts,css 'just build-userscript dev'

build-userscript:
    cd userscript && node build-userscript.ts dev

test:
    cd userscript && pnpm test

serve-userscript:
    python3 -m http.server 8080 --directory userscript/target/userscript

watch-and-serve-userscript:
    just default & just serve-userscript

build-server:
    cd server && cargo build -r

run-server *args:
    cd server && cargo run --release -- {{args}}

watch-server:
    cd server && watchexec -e rs,sql 'cargo run --release'

build:
    just build-userscript
    just build-server

format:
    cd userscript && pnpm exec prettier --write ../AGENTS.md
    cd userscript && pnpm exec prettier --write .

format-check:
    cd userscript && pnpm exec prettier --check ../AGENTS.md
    cd userscript && pnpm exec prettier --check .

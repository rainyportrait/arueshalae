# Build and dev loop for both halves of the project.

[parallel]
default: watch-and-serve-userscript watch-server

build-userscript version='dev':
    cd userscript && node build-userscript.ts {{version}}

watch-userscript:
    watchexec -w userscript -e ts,css 'just build-userscript dev'

serve-userscript:
    python3 -m http.server 8080 --directory userscript/target/userscript

watch-and-serve-userscript: watch-userscript serve-userscript

build-server:
    cd server && cargo build -r

watch-server:
    cd server && watchexec -e rs,sql 'cargo run --release'

run-server *args:
    cd server && cargo run --release -- {{args}}

[parallel]
build: build-userscript build-server

format:
    cd userscript && pnpm exec prettier --write ../AGENTS.md
    cd userscript && pnpm exec prettier --write .

format-check:
    cd userscript && pnpm exec prettier --check ../AGENTS.md
    cd userscript && pnpm exec prettier --check .

test:
    cd userscript && pnpm test

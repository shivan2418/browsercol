# Everything runs in the Docker dev image through ./dev.sh (see README.md).
# `just` with no recipe lists them.

port := "5173"

_default:
    @just --list

# Install the UI's npm packages (once, and after package-lock.json changes)
install:
    ./dev.sh -C ui npm ci --no-audit --no-fund

# Build dist/, the static site (`just build -Prelease` for obfuscated modules)
build *args:
    ./dev.sh ./build.sh {{args}}

# Vite dev server with hot reload at http://localhost:5173 (builds first if ui/generated/ is missing or older than the Engine's Java)
dev:
    [ -f ui/generated/client.wasm ] && [ -z "$(find engine/src engine/patches engine/*.gradle* -newer ui/generated/client.wasm -type f -print -quit 2>/dev/null)" ] || just build
    DEV_PORT={{port}} ./dev.sh -C ui npx vp dev --host 0.0.0.0 --port {{port}} --strictPort

# Serve the built dist/ at http://localhost:5173
preview:
    [ -f dist/index.html ] || just build
    DEV_PORT={{port}} ./dev.sh -C ui npx vp preview --host 0.0.0.0 --port {{port}} --strictPort

# JVM tests of the Engine
test-engine *args:
    ./dev.sh -C engine gradle test {{args}}

# UI tests
test-ui *args:
    ./dev.sh -C ui npx vp test {{args}}

# Format, lint and type check
check:
    ./dev.sh -C ui npx vp check

# The fast checks a ticket PR needs: Engine tests, vp check, vp test
fast: test-engine check test-ui

# Browser script against dist/: smoke, play, saves, tileset or rounds
browser script *args:
    DEV_VARIANT=web ./dev.sh node ui/scripts/{{script}}.mjs {{args}}

# The whole local suite: fast checks, build and the browser scripts
suite: fast build (browser "smoke") (browser "play") (browser "tileset")

# Run the whole suite on GitHub Actions for the committed HEAD
ci:
    ./ci.sh

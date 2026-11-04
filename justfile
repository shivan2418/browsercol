# Everything runs in the Docker dev image through ./dev.sh (see README.md).
# `just` with no recipe lists them.

port := "5173"

_default:
    @just --list

# Install the UI's packages (once, and after pnpm-lock.yaml changes)
install:
    ./dev.sh -C ui pnpm install --frozen-lockfile

# Build dist/, the static site (`just build -Prelease` for obfuscated modules)
build *args:
    ./dev.sh ./build.sh {{args}}

# Vite dev server with hot reload at the first free port from 5173 up, so worktrees can each run one (builds first if ui/generated/ is missing or older than the Engine's Java; rebuilds the Engine and reloads the page when its Java changes)
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -f ui/generated/client.wasm ] && [ -z "$(find engine/src engine/patches engine/*.gradle* -newer ui/generated/client.wasm -type f -print -quit 2>/dev/null)" ] || just build
    port={{port}}
    while (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do port=$((port + 1)); done
    echo "Dev server: http://localhost:$port"
    DEV_PORT=$port ./dev.sh bash -c 'tools/watch-engine.sh & cd ui && exec pnpm exec vp dev --host 0.0.0.0 --port "$1" --strictPort' _ "$port"

# Serve the built dist/ at http://localhost:5173
preview:
    [ -f dist/index.html ] || just build
    DEV_PORT={{port}} ./dev.sh -C ui pnpm exec vp preview --host 0.0.0.0 --port {{port}} --strictPort

# Storybook at http://localhost:6006, with the game's own art (builds first if ui/generated/ has none)
storybook:
    [ -d ui/generated/public/art ] || just build
    DEV_PORT=6006 ./dev.sh -C ui pnpm exec storybook dev -p 6006 --host 0.0.0.0 --no-open

# JVM tests of the Engine
test-engine *args:
    ./dev.sh -C engine gradle test {{args}}

# UI tests
test-ui *args:
    ./dev.sh -C ui pnpm exec vp test {{args}}

# Format, lint and type check
check:
    ./dev.sh -C ui pnpm exec vp check

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

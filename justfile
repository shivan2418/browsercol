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
storybook: art
    DEV_PORT=6006 ./dev.sh -C ui pnpm exec storybook dev -p 6006 --host 0.0.0.0 --no-open

# Deploy origin/main (or a given commit) to GitHub Pages as the next build-N
deploy *commit:
    tools/deploy.sh {{commit}}

# JVM tests of the Engine
test-engine *args:
    ./dev.sh -C engine gradle test {{args}}

# UI tests
test-ui *args:
    ./dev.sh -C ui pnpm exec vp test {{args}}

# The default Tileset's art manifest, ui/generated/public/art/art.json, which src/story-art.ts imports (about 20 s; skipped when it exists, `just build` makes it too)
art:
    [ -f ui/generated/public/art/art.json ] || ./dev.sh node ui/scripts/build-art.ts freecol/data ui/generated/public/art

# Format, lint and type check (makes the art manifest first if a fresh checkout has none)
check: art
    ./dev.sh -C ui pnpm exec vp check

# The feedback relay's format, lint, type check and tests (relay/, #370)
relay:
    ./dev.sh -C relay pnpm install --frozen-lockfile
    ./dev.sh -C relay pnpm exec vp check
    ./dev.sh -C relay pnpm exec vp test

# Build and deploy the feedback relay to AWS (by hand; see relay/deploy.sh)
deploy-relay *args:
    relay/deploy.sh {{args}}

# The fast checks a ticket PR needs: Engine tests, vp check, vp test (the UI's and the relay's)
fast: test-engine check test-ui relay

# Browser script against dist/: smoke, play, saves, tileset, looks or rounds
browser script *args:
    DEV_VARIANT=web ./dev.sh node ui/scripts/{{script}}.ts {{args}}

# The whole local suite: fast checks, build and the browser scripts
suite: fast build (browser "smoke") (browser "play") (browser "tileset") (browser "looks")

# Approve the key panels' screenshots (ui/looks/) after a change meant to show: look at .cache/looks/ first, then commit them
looks-approve *args:
    DEV_VARIANT=web ./dev.sh node ui/scripts/looks.ts --approve {{args}}

# Run the whole suite on GitHub Actions for the committed HEAD
ci:
    ./ci.sh

# Open a save in the upstream Java FreeCol (Swing) on this desktop: a path, "last" (newest autosave) or a save name
swing save *args:
    tools/fc-swing/open.sh {{save}} {{args}}

# Upstream Java FreeCol on a virtual screen, driven and screenshotted: -s SAVE, then steps like wait:40000 shot:map key:F1 (see tools/fc-swing/shot.sh)
swing-shot *args:
    tools/fc-swing/shot.sh {{args}}

# The Swing parity inventory: Swing's player actions, row by row, into docs/parity
parity:
    ./dev.sh node tools/swing-inventory.mjs

# Run the browser scripts that count which dialogs a real game reaches (after `just build`), then merge the counts
dialog-coverage-run: (browser "smoke") (browser "play") (browser "saves") (browser "europe") (browser "debug") (browser "tileset") dialog-coverage

# Merge the scripts' dialog counts (.cache/coverage) into docs/parity/dialog-coverage.md
dialog-coverage:
    ./dev.sh node tools/dialog-coverage.mjs

# The stable playtest server at http://localhost:5174/play/: the playtest worktree's built dist/, no hot reload
playtest:
    tools/playtest.sh serve

# Move the playtest server to main (or a given ref) and rebuild it; the open tab changes only when you reload it
playtest-update *ref:
    tools/playtest.sh update {{ref}}

# Which commit the playtest server has, and what main has that it doesn't yet
playtest-status:
    tools/playtest.sh status

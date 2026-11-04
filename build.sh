#!/usr/bin/env bash
# Build dist/, the static site: both Engine modules, the data bundle and the
# Browser UI. Run in the dev image:
#   ./dev.sh ./build.sh              (dev build of the modules)
#   ./dev.sh ./build.sh -Prelease    (obfuscated release build)
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
cd "$repo"

gradle -p engine --console=plain modules "$@"

# The Vite build imports these from ui/generated (git-ignored).
src=engine/build/generated/teavm/wasm-gc
gen=ui/generated
rm -rf "$gen"; mkdir -p "$gen"
cp "$src/server.wasm" "$src/client.wasm" "$gen/"
# Both modules ship the same runtime; the site serves one copy.
cmp -s "$src/server.wasm-runtime.js" "$src/client.wasm-runtime.js" \
  || { echo "server and client TeaVM runtimes differ" >&2; exit 1; }
cp "$src/client.wasm-runtime.js" "$gen/teavm-runtime.js"
node ui/scripts/build-data.mjs freecol/data "$gen/data.json"
# Map art, served as files under art/ (Vite's public dir), and the test
# Tileset's manifest beside the default's (the page's ?tileset=test).
node ui/scripts/build-art.mjs freecol/data "$gen/public/art"
node ui/scripts/build-art.mjs freecol/data "$gen/public/art" --manifest test.json ui/tilesets/test
# Music and sound effects, served as files under audio/, each fetched when it plays.
node ui/scripts/build-audio.mjs freecol/data "$gen/public/audio"
# Debug quick-start presets, served as presets/NAME.json (the page's ?preset=NAME).
mkdir -p "$gen/public/presets"
cp ui/presets/*.json "$gen/public/presets/"

cd ui
pnpm install --frozen-lockfile
pnpm exec vp build

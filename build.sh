#!/usr/bin/env bash
# Build dist/, the static site: both Engine modules, the data bundle and the
# Browser UI. Run in the dev image:
#   ./dev.sh ./build.sh              (dev build of the modules)
#   ./dev.sh ./build.sh -Prelease    (release build: obfuscated modules, and
#                                     the Browser UI in Vite's release mode,
#                                     which hides the debug side panel at first)
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
cd "$repo"

gradle -p engine --console=plain modules "$@"

# The Vite build imports these from ui/generated (git-ignored).
gen=ui/generated
rm -rf "$gen"
tools/copy-modules.sh
# FreeCol's translations, served as strings/ and fetched as the player picks one.
node ui/scripts/build-data.mjs freecol/data "$gen/data.json" "$gen/public/strings"
# Map art, served as files under art/ (Vite's public dir), and each other
# Tileset's manifest beside the default's: FreeCol+ (the page's
# ?tileset=freecol-plus) and the test Tileset (?tileset=test).
node ui/scripts/build-art.mjs freecol/data "$gen/public/art"
node ui/scripts/build-art.mjs freecol/data "$gen/public/art" --manifest freecol-plus.json ui/tilesets/freecol-plus
node ui/scripts/build-art.mjs freecol/data "$gen/public/art" --manifest test.json ui/tilesets/test
# Music and sound effects, served as files under audio/, each fetched when it plays.
node ui/scripts/build-audio.mjs freecol/data "$gen/public/audio"
# Debug quick-start presets, served as presets/NAME.json (the page's ?preset=NAME).
mkdir -p "$gen/public/presets"
cp ui/presets/*.json "$gen/public/presets/"

cd ui
pnpm install --frozen-lockfile
mode=()
for arg in "$@"; do [[ $arg == -Prelease ]] && mode=(--mode release); done
pnpm exec vp build "${mode[@]}"

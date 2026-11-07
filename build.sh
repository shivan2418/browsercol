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
node ui/scripts/build-data.ts freecol/data "$gen/data.json" "$gen/public/strings"
# Map art, served as files under art/ (Vite's public dir), and each other
# Tileset's manifest beside the default's: FreeCol+ (the page's
# ?tileset=freecol-plus) and the test Tileset (?tileset=test).
node ui/scripts/build-art.ts freecol/data "$gen/public/art"
node ui/scripts/build-art.ts freecol/data "$gen/public/art" --manifest freecol-plus.json ui/tilesets/freecol-plus
node ui/scripts/build-art.ts freecol/data "$gen/public/art" --manifest test.json ui/tilesets/test
# Music and sound effects, served as files under audio/, each fetched when it plays.
node ui/scripts/build-audio.ts freecol/data "$gen/public/audio"
# BrowserCol's own wordmark globes, the loading screen's picture (index.html, brand/).
mkdir -p "$gen/public/brand"
cp ui/brand/globe-*.svg "$gen/public/brand/"
# Debug quick-start presets, served as presets/NAME.json (the page's ?preset=NAME).
mkdir -p "$gen/public/presets"
cp ui/presets/*.json "$gen/public/presets/"

rm -rf dist
cd ui
pnpm install --frozen-lockfile
# The favicon and the web app icons, rendered from BrowserCol's icon (brand/), served as icons/.
# After the install, as it renders with resvg.
node scripts/build-icons.ts brand "generated/public/icons"
mode=()
for arg in "$@"; do [[ $arg == -Prelease ]] && mode=(--mode release); done
pnpm exec vp build "${mode[@]}"

# The landing page (ui/site/, plain static files) at the site's root, with the logo and fonts it uses.
cd "$repo"
cp -r ui/site/. dist/
mkdir -p dist/brand dist/fonts
cp ui/brand/wordmark.svg ui/brand/globe-*.svg ui/brand/icon.svg dist/brand/
cp ui/src/fonts/cinzel/cinzel-latin-{400,700}-normal.woff2 ui/src/fonts/noto-sans/noto-sans-latin-{400,700}-normal.woff2 dist/fonts/
cp ui/src/fonts/cinzel/OFL.txt dist/fonts/OFL-cinzel.txt 2>/dev/null || true
cp ui/src/fonts/noto-sans/OFL.txt dist/fonts/OFL-noto-sans.txt 2>/dev/null || true

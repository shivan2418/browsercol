#!/usr/bin/env bash
# Put the landing page (ui/site/, plain static files) at the root of a site
# directory, with the logo and fonts it uses. build.sh runs it after the game
# build; the Site workflow runs it around the last released game (#374).
# Usage: tools/site.sh <dir>     (default: dist)
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:-$repo/dist}"
cd "$repo"
cp -r ui/site/. "$out/"
mkdir -p "$out/brand" "$out/fonts"
cp ui/brand/wordmark.svg ui/brand/globe-*.svg ui/brand/icon.svg "$out/brand/"
cp ui/src/fonts/cinzel/cinzel-latin-{400,700}-normal.woff2 ui/src/fonts/noto-sans/noto-sans-latin-{400,700}-normal.woff2 "$out/fonts/"
cp ui/src/fonts/cinzel/OFL.txt "$out/fonts/OFL-cinzel.txt" 2>/dev/null || true
cp ui/src/fonts/noto-sans/OFL.txt "$out/fonts/OFL-noto-sans.txt" 2>/dev/null || true
# The changes page, and the latest builds on the landing page, from ui/site/changes.json (#402).
node ui/scripts/build-changes.ts ui/site/changes.json "$out"

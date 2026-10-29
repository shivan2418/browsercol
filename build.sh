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
# Map art, served as files under art/ (Vite's public dir).
node ui/scripts/build-art.mjs freecol/data "$gen/public/art"

cd ui
npm ci --no-audit --no-fund
npx vp build

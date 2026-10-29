#!/usr/bin/env bash
# Assemble spike/web/dist, the servable page. Run via the dev image:
#   ./dev.sh spike/web/build.sh            (real TeaVM build output)
#   ./dev.sh env FAKE=1 spike/web/build.sh (fake modules from spike/web/fake)
set -euo pipefail
web="$(cd "$(dirname "$0")" && pwd)"
repo="$web/../.."
dist="$web/dist"
rm -rf "$dist"; mkdir -p "$dist/vendor"

cp "$web"/{index.html,main.js,worker.js} "$dist/"

# The two Engine modules and their runtimes.
if [[ -n "${FAKE:-}" ]]; then
  cp "$web"/fake/*.wasm-runtime.js "$dist/"
  # Dummy payloads stand in for the wasm so transfer sizes are not zero.
  for m in server client; do head -c 200000 /dev/urandom > "$dist/$m.wasm"; done
else
  src="$repo/spike/engine/build/generated/teavm/wasm-gc"
  for m in server client; do cp "$src/$m.wasm" "$src/$m.wasm-runtime.js" "$dist/"; done
fi

# PixiJS, served locally (ADR 0001: no runtime CDN). Cached under .cache.
pixi=8.14.0
cache="$repo/.cache/pixi-$pixi"
if [[ ! -f "$cache/node_modules/pixi.js/dist/pixi.min.js" ]]; then
  mkdir -p "$cache"; (cd "$cache" && npm install --no-audit --no-fund --silent "pixi.js@$pixi")
fi
cp "$cache/node_modules/pixi.js/dist/pixi.min.js" "$dist/vendor/"
echo "pixi.js $pixi (npm), built pixi.min.js" > "$dist/vendor/VERSION.txt"

node "$web/build-data.mjs" "$repo/freecol/data" "$dist/data.json"
ls -l "$dist"

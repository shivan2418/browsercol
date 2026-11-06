#!/usr/bin/env bash
# Copy the Engine modules from Gradle's output into ui/generated, where the
# Browser UI imports them. Each file is written beside its target and then
# renamed, so a running Vite dev server never reads a half-written module;
# an unchanged one is not touched.
# Run in the dev image, from the repo root.
set -euo pipefail
src=engine/build/generated/teavm
gen=ui/generated
mkdir -p "$gen"
# Both modules ship the same runtime; the site serves one copy.
cmp -s "$src/server/server.wasm-runtime.js" "$src/client/client.wasm-runtime.js" \
  || { echo "server and client TeaVM runtimes differ" >&2; exit 1; }
# A module that came out the same is left alone, so Vite does not reload for it.
put() {
  cmp -s "$1" "$2" && return
  cp "$1" "$2.tmp"
  mv "$2.tmp" "$2"
}
put "$src/server/server.wasm" "$gen/server.wasm"
put "$src/client/client.wasm" "$gen/client.wasm"
# The runtime imports the module's JS by a path it is given at run time, on
# purpose; marked so, Vite stops warning that it cannot follow the import.
# It is found by its place, first in a Promise.all with the wasm's compile,
# not by its name: a release build minifies import(pathToJs) to import(t).
runtime=$(mktemp)
trap 'rm -f "$runtime"' EXIT
perl -0pe 's|(Promise\.all\(\[\s*)import\(([\w\$]+)\)|$1import(/* \@vite-ignore */ $2)|' \
  "$src/client/client.wasm-runtime.js" > "$runtime"
grep -q 'vite-ignore' "$runtime" \
  || { echo "TeaVM runtime: no import(pathToJs) to mark for Vite" >&2; exit 1; }
put "$runtime" "$gen/teavm-runtime.js"

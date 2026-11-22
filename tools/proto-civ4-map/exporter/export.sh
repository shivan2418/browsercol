#!/usr/bin/env bash
# THROWAWAY (#405): regenerate maps/topdown.json and maps/isometric.json from the Engine (seed 3).
set -euo pipefail
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
t=$repo/engine/src/test/java/browsercol/web/ExportMapsTest.java
cp "$repo/tools/proto-civ4-map/exporter/ExportMapsTest.java" "$t"
trap 'rm -f "$t"' EXIT
"$repo/dev.sh" -C engine gradle test --tests browsercol.web.ExportMapsTest -i

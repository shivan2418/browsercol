#!/usr/bin/env bash
# Resample FreeCol's 22 staggered maps into north-up square grids, and lay the America map of ours square (#528).
# Runs in the dev image; nothing is installed on the host. The originals are read from git at ORIG (the last commit
# that has them staggered), so running it again gives the same files.
#   tools/resample-maps.sh [DUMP_DIR]   (DUMP_DIR gets a small PNG of every map, a tile to 4 pixels)
set -euo pipefail
cd "$(dirname "$0")/.."
ORIG=${ORIG:-a1d9df7e}
mkdir -p .cache
work=$(mktemp -d "$PWD/.cache/resample.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/in" "$work/out" "$work/png"
for f in $(git ls-tree --name-only "$ORIG" freecol/data/maps/ | grep '\.fsm$'); do
  git show "$ORIG:$f" > "$work/in/$(basename "$f")"
done
git show "$ORIG:ui/maps/america-1492.txt" > "$work/america-staggered.txt"
rel=${work#"$PWD"/}
dump=${1:+/work/$rel/png}
./dev.sh -C engine gradle -q resampleMaps "-PresampleArgs=resample /work/$rel/in /work/$rel/out ${dump:-}"
./dev.sh -C engine gradle -q resampleMaps "-PresampleArgs=america /work/$rel/america-staggered.txt /work/$rel/america.txt ${dump:+/work/$rel/png/America_1492.png}"
cp "$work"/out/*.fsm freecol/data/maps/
cp "$work/america.txt" ui/maps/america-1492.txt
if [ -n "${1:-}" ]; then mkdir -p "$1"; cp "$work"/png/*.png "$1"/; fi

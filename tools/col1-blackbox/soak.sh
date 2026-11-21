#!/usr/bin/env bash
# Run one do-nothing soak from an origin save in its own container.
# Usage: soak.sh OUTDIR ORIGIN.SAV [soak.py args...]
set -euo pipefail
out=$(realpath -m "$1") save=$(realpath "$2"); shift 2
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
game=${COL1_GAME:-"$HOME/GOG Games/Sid Meiers Colonization"}
exec docker run --rm --name "col1-$(basename "$out")" \
  -v "$game":/game:ro -v "$here":/harness:ro -v "$out":/out -v "$save":/origin.sav:ro \
  col1-blackbox bash -c '
    mkdir -p /work && cp -r /game/data /work/data
    cp /origin.sav /work/data/MPS/COLONIZE/COLONY00.SAV
    Xvfb :1 -screen 0 640x480x24 >/dev/null 2>&1 &
    sleep 1
    export DISPLAY=:1 SDL_AUDIODRIVER=dummy
    dosbox -conf /game/dosboxCOL.conf -conf /harness/dosbox-harness.conf >/dev/null 2>&1 &
    sleep 1
    cd /harness && python3 soak.py --out /out "$@"' _ "$@"

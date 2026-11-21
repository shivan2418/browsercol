#!/usr/bin/env bash
# Run one observed game in its own container.
# Usage: run.sh OUTDIR [observe.py args...]   e.g. run.sh runs/d0-001 --difficulty 0
set -euo pipefail
out=$(realpath -m "$1"); shift
mkdir -p "$out"
here=$(cd "$(dirname "$0")" && pwd)
game=${COL1_GAME:-"$HOME/GOG Games/Sid Meiers Colonization"}
exec docker run --rm --name "col1-$(basename "$out")" \
  -v "$game":/game:ro -v "$here":/harness:ro -v "$out":/out \
  col1-blackbox bash -c '
    mkdir -p /work && cp -r /game/data /work/data
    Xvfb :1 -screen 0 640x480x24 >/dev/null 2>&1 &
    sleep 1
    export DISPLAY=:1 SDL_AUDIODRIVER=dummy
    dosbox -conf /game/dosboxCOL.conf -conf /harness/dosbox-harness.conf >/dev/null 2>&1 &
    cd /harness && python3 observe.py --out /out "$@"' _ "$@"

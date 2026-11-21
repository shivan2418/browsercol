#!/usr/bin/env bash
# Start a detached container for hand exploration with poke.sh.
# Usage: probe.sh NAME [ORIGIN.SAV]   (the save is installed as slot 1)
set -euo pipefail
name=$1 save=${2:-}
here=$(cd "$(dirname "$0")" && pwd)
game=${COL1_GAME:-"$HOME/GOG Games/Sid Meiers Colonization"}
mkdir -p "$here/runs/$name"
args=(-v "$game":/game:ro -v "$here":/harness:ro -v "$here/runs/$name":/out)
[ -n "$save" ] && args+=(-v "$(realpath "$save")":/origin.sav:ro)
docker run -d --rm --name "$name" "${args[@]}" col1-blackbox bash -c '
  mkdir -p /work && cp -r /game/data /work/data
  [ -f /origin.sav ] && cp /origin.sav /work/data/MPS/COLONIZE/COLONY00.SAV
  Xvfb :1 -screen 0 640x480x24 >/dev/null 2>&1 &
  sleep 1; export DISPLAY=:1 SDL_AUDIODRIVER=dummy
  dosbox -conf /game/dosboxCOL.conf -conf /harness/dosbox-harness.conf >/dev/null 2>&1
  sleep infinity' >/dev/null

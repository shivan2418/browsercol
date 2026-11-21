#!/usr/bin/env bash
# Exploration helper: send keys to an instance, wait, save a screenshot.
# Usage: poke.sh NAME OUT.png [WAIT_SECONDS] [xdotool key names...]
set -euo pipefail
name=$1 out=$2 wait=${3:-1}; shift 3 || shift $#
docker exec "$name" bash -c '
  export DISPLAY=:1
  w=$(xdotool search --class dosbox | head -1)
  xdotool windowfocus --sync "$w" 2>/dev/null || true
  for k in "$@"; do xdotool key --window "$w" --delay 80 "$k"; sleep 0.25; done
  sleep '"$wait"'
  import -window "$w" /tmp/raw.png; convert /tmp/raw.png -scale 200% /tmp/shot.png' _ "$@"
docker cp -q "$name":/tmp/shot.png "$out"

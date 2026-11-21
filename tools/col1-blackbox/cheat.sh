#!/usr/bin/env bash
# Turn on the game's built-in cheat mode (hold Alt, type WIN). Usage: cheat.sh NAME
docker exec "$1" bash -c 'export DISPLAY=:1; w=$(xdotool search --class dosbox|head -1)
  xdotool keydown --window $w alt; sleep 0.2
  for k in w i n; do xdotool key --window $w $k; sleep 0.2; done
  xdotool keyup --window $w alt'

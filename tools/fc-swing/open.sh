#!/bin/sh
# Open a save in the upstream Java FreeCol (Swing) on this desktop, to play it or compare it by eye.
#   open.sh SAVE [FreeCol args...]   SAVE: a path, "last" or a save name (see save.sh)
# Runs the host's java with your own FreeCol settings; the jar is built in Docker the first time.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
C=${FC_SWING_CACHE:-$HOME/.cache/freecol-swing}
f=$("$D/save.sh" "$1"); shift
"$D/build.sh"
cd "$C/src" && exec java -Xmx2G -jar FreeCol.jar --freecol-data data --no-intro --no-splash --windowed \
  --load-savegame "$f" "$@"

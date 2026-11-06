#!/bin/sh
# Run the upstream Java FreeCol (Swing) on a virtual screen in Docker and drive it with screenshots.
#   shot.sh [-s SAVE] [-a "FreeCol args"] STEP...
# SAVE: a path, "last" or a save name (see save.sh). Steps (Drive.java): wait:MS shot:NAME click:X,Y
# rclick:X,Y key:F1|ENTER|CONTROL+S type:TEXT. A save takes about 40 s to load, so start with wait:40000.
# Screenshots: ~/.cache/freecol-swing/shots/NAME.png; FreeCol's log: shots/freecol.log. SIZE=WxH sets the screen.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
C=${FC_SWING_CACHE:-$HOME/.cache/freecol-swing}
"$D/build.sh"
ARGS=""; MOUNT=""
while getopts s:a: o; do case $o in
  s) f=$("$D/save.sh" "$OPTARG"); MOUNT="-v $f:/save.fsg:ro"; ARGS="$ARGS --load-savegame /save.fsg" ;;
  a) ARGS="$ARGS $OPTARG" ;;
esac; done
shift $((OPTIND - 1))
J=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
# A Debian JDK's conf/ links into /etc/java-N-openjdk, so mount that too when it exists.
E=$(readlink -f "$J/conf" || true)
EM=""; [ -n "$E" ] && [ "$E" != "$J/conf" ] && EM="-v $E:$E:ro"
exec docker run --rm -e FC_ARGS="$ARGS" -e SIZE -v "$J":/jdk:ro $EM -v "$C":/w -v "$D":/drive:ro $MOUNT \
  --entrypoint sh browsercol-web /drive/run.sh "$@"

#!/bin/sh
# Inside the container (see shot.sh): Xvfb, FreeCol with $FC_ARGS, then the Drive.java steps given as arguments.
Xvfb :99 -screen 0 "${SIZE:-1280x800}x24" >/dev/null 2>&1 &
export DISPLAY=:99 HOME=/tmp/fc XDG_DATA_HOME=/tmp/fc/xdg XDG_CONFIG_HOME=/tmp/fc/xdgc XDG_CACHE_HOME=/tmp/fc/xdgk
mkdir -p /tmp/fc/xdg /tmp/fc/xdgc /tmp/fc/xdgk /tmp/fc/cfg /tmp/fc/data /tmp/fc/cache
sleep 1
cd /w/src && eval "/jdk/bin/java -Xmx2G -jar FreeCol.jar --freecol-data data --no-intro --no-splash --no-sound \
  --windowed ${SIZE:-1280x800} --user-config-directory /tmp/fc/cfg --user-data-directory /tmp/fc/data \
  --user-cache-directory /tmp/fc/cache $FC_ARGS" > /w/shots/freecol.log 2>&1 &
/jdk/bin/java /drive/Drive.java "$@"

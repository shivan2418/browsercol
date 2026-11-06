#!/bin/sh
# Build the upstream FreeCol.jar (the Swing game) at freecol.sha into ~/.cache/freecol-swing/src.
# Ant comes from Maven Central and runs in Docker; nothing is installed on the host. Skips the build
# when the jar is already there for this sha.
set -eu
REPO=$(cd "$(dirname "$0")/../.." && pwd)
C=${FC_SWING_CACHE:-$HOME/.cache/freecol-swing}
SHA=$(cat "$REPO/freecol.sha")
mkdir -p "$C/shots"
[ -f "$C/src/FreeCol.jar" ] && [ "$(cat "$C/built.sha" 2>/dev/null)" = "$SHA" ] && exit 0
[ -d "$C/src" ] || git clone -q --shared "$REPO/freecol" "$C/src"
git -C "$C/src" fetch -q origin 2>/dev/null || true
git -C "$C/src" checkout -q --detach "$SHA"
# The clone borrows the repo's objects, so mount them at the same path for the jar's git revision.
docker run --rm -v "$C":/w -v "$REPO/freecol":"$REPO/freecol":ro --entrypoint sh browsercol-agent -c '
  git config --global --add safe.directory "*"
  set -e; mkdir -p /w/ant
  for a in ant ant-launcher; do [ -f /w/ant/$a.jar ] || curl -fsS --max-time 120 -o /w/ant/$a.jar \
    https://repo1.maven.org/maven2/org/apache/ant/$a/1.10.15/$a-1.10.15.jar; done
  cd /w/src && java -cp "/w/ant/*" org.apache.tools.ant.launch.Launcher -lib /w/ant -q package'
echo "$SHA" > "$C/built.sha"

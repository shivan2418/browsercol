#!/bin/sh
# Build the upstream FreeCol.jar (the Swing game) at the commit this repo's freecol/ was vendored from, into
# ~/.cache/freecol-swing/src. It is built from FreeCol's own repository, not from freecol/, which holds our changes.
# Ant comes from Maven Central and runs in Docker; nothing is installed on the host. Skips the build
# when the jar is already there for this sha.
set -eu
C=${FC_SWING_CACHE:-$HOME/.cache/freecol-swing}
SHA=1c272e80d2f8946e096063f6d88eb945a44f789d
mkdir -p "$C/shots"
[ -f "$C/src/FreeCol.jar" ] && [ "$(cat "$C/built.sha" 2>/dev/null)" = "$SHA" ] && exit 0
if [ ! -d "$C/src" ]; then git init -q "$C/src"; fi
git -C "$C/src" cat-file -e "$SHA^{commit}" 2>/dev/null \
  || git -C "$C/src" fetch -q --depth 1 https://github.com/FreeCol/freecol.git "$SHA"
git -C "$C/src" checkout -q --detach "$SHA"
docker run --rm -v "$C":/w --entrypoint sh browsercol-agent -c '
  git config --global --add safe.directory "*"
  set -e; mkdir -p /w/ant
  for a in ant ant-launcher; do [ -f /w/ant/$a.jar ] || curl -fsS --max-time 120 -o /w/ant/$a.jar \
    https://repo1.maven.org/maven2/org/apache/ant/$a/1.10.15/$a-1.10.15.jar; done
  cd /w/src && java -cp "/w/ant/*" org.apache.tools.ant.launch.Launcher -lib /w/ant -q package'
echo "$SHA" > "$C/built.sha"

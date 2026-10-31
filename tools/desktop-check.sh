#!/usr/bin/env bash
# Checks that stock desktop FreeCol accepts a save file: runs its
# --check-savegame on it, headless and with a private home, and reports the
# "Game integrity test" line of its log (#69).
#
# Usage: tools/desktop-check.sh <FreeCol install dir> <file.fsg>
#   The install dir holds FreeCol.jar, jars/ and data/ (desktop FreeCol 1.2.0).
#   Runs in the dev image through ./dev.sh; scratch files go to .cache/desktop-home.
#   Exits 0 only if the log says the integrity test succeeded.
set -euo pipefail
[[ $# -eq 2 ]] || { echo "usage: $0 <FreeCol install dir> <file.fsg>" >&2; exit 2; }
repo="$(cd "$(dirname "$0")/.." && pwd)"
install="$(cd "$1" && pwd)"
save="$(readlink -f "$2")"
[[ -f "$install/FreeCol.jar" && -d "$install/data" ]] || { echo "$1 is not a FreeCol install dir" >&2; exit 2; }
[[ -f "$save" ]] || { echo "no such file: $2" >&2; exit 2; }

# The dev image sees only the repo, so stage the install and the save under .cache/.
cache="$repo/.cache"
home="$cache/desktop-home"
[[ "$install" != "$cache/desktop-freecol" ]] || { echo "pass the real install dir, not the staging copy" >&2; exit 2; }
rm -rf "$home" "$cache/desktop-freecol" "$cache/desktop-check.fsg"
mkdir -p "$home/.local/share" "$home/.config" "$home/.cache" "$cache/desktop-freecol"
cp -r "$install/FreeCol.jar" "$install/jars" "$install/data" "$cache/desktop-freecol/"
cp "$save" "$cache/desktop-check.fsg"

# The exit status of --check-savegame is not the verdict; the log is.
"$repo/dev.sh" java -Duser.home=/work/.cache/desktop-home -Djava.awt.headless=true \
  -jar .cache/desktop-freecol/FreeCol.jar --freecol-data .cache/desktop-freecol/data \
  --private --check-savegame .cache/desktop-check.fsg >"$cache/desktop-check.out" 2>&1 || true
log="$home/.cache/freecol/FreeCol.log"
rm -f "$cache/desktop-check.fsg"
[[ -f "$log" ]] || { echo "no FreeCol log at $log" >&2; exit 1; }
grep -i -A1 "integrity test" "$log" | grep -v "^--" || true
if grep -q "Game integrity test succeeded" "$log"; then
  echo "desktop FreeCol accepts $(basename "$save")"
else
  echo "desktop FreeCol did NOT accept $(basename "$save"); see $log" >&2
  exit 1
fi

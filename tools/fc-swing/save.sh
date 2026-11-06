#!/bin/sh
# Resolve a save name to a path: an existing path; "last" (the newest autosave); or a name (with or
# without .fsg) found in ~/.local/share/freecol/save, its autosave folder, or ui/scripts/fixtures.
REPO=$(cd "$(dirname "$0")/../.." && pwd)
S=$HOME/.local/share/freecol/save
case "$1" in
  last) ls -t "$S"/autosave/*.fsg 2>/dev/null | head -1; exit ;;
esac
[ -f "$1" ] && { readlink -f "$1"; exit; }
for d in "$S" "$S/autosave" "$REPO/ui/scripts/fixtures"; do
  for f in "$d/$1" "$d/$1.fsg"; do [ -f "$f" ] && { echo "$f"; exit; }; done
done
echo "no save named $1" >&2; exit 1

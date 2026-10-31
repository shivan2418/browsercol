#!/usr/bin/env bash
# Put freecol/, the git-ignored upstream clone, on the commit pinned in
# freecol.sha, cloning it if missing. engine/patches/ replace whole upstream
# files, so the Engine builds only against that commit. To move to a newer
# FreeCol, change freecol.sha, run this, and fix the patches.
set -euo pipefail
cd "$(dirname "$0")"
repo=https://github.com/FreeCol/freecol.git
sha=$(<freecol.sha)
[[ -e freecol/.git ]] || git init -q freecol
git -C freecol cat-file -e "$sha^{commit}" 2>/dev/null \
  || git -C freecol fetch -q --depth 1 "$repo" "$sha"
git -C freecol checkout -q --detach "$sha"

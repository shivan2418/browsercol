#!/usr/bin/env bash
# Put freecol/, the git-ignored upstream clone, on the commit pinned in
# freecol.sha, cloning it if missing. engine/patches/ replace whole upstream
# files, so the Engine builds only against that commit.
#
#   ./freecol.sh              check out the pinned commit
#   ./freecol.sh <ref>        pin a new upstream commit, branch or tag, check
#                             it out, and list the patched files it changed
#
# After a new pin, merge the listed upstream changes into engine/patches/,
# then run the whole suite (./ci.sh on a branch keeps the machine free).
set -euo pipefail
cd "$(dirname "$0")"
repo=https://github.com/FreeCol/freecol.git
old=$(<freecol.sha)
[[ -e freecol/.git ]] || git init -q freecol
# A new or shallow clone (CI's) fetches single commits, a full one history.
depth=()
if ! git -C freecol rev-parse -q --verify HEAD >/dev/null \
  || [[ $(git -C freecol rev-parse --is-shallow-repository) == true ]]; then
  depth=(--depth 1)
fi

if [[ $# -gt 0 ]]; then
  git -C freecol fetch -q "${depth[@]}" "$repo" "$1"
  new=$(git -C freecol rev-parse FETCH_HEAD)
  echo "$new" > freecol.sha
  echo "freecol.sha: $old -> $new"
fi

sha=$(<freecol.sha)
git -C freecol cat-file -e "$sha^{commit}" 2>/dev/null \
  || git -C freecol fetch -q "${depth[@]}" "$repo" "$sha"
git -C freecol checkout -q --detach "$sha"

if [[ $sha != "$old" ]]; then
  git -C freecol cat-file -e "$old^{commit}" 2>/dev/null \
    || git -C freecol fetch -q --depth 1 "$repo" "$old"
  changed=$(git -C freecol diff --name-only "$old" "$sha" -- src)
  stale=$(cd engine/patches && find . -name '*.java' | sed 's|^\./|src/|' \
    | grep -Fxf <(echo "$changed") || true)
  data=$(git -C freecol diff --name-only "$old" "$sha" -- data | grep -c . || true)
  echo "$(echo "$changed" | grep -c . || true) upstream source and $data data files changed."
  if [[ -n $stale ]]; then
    echo "Patched files whose upstream changed (merge into engine/patches/):"
    echo "$stale" | sed 's/^/  /'
  else
    echo "No patched file changed upstream."
  fi
fi

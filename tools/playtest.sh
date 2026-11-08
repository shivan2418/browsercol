#!/usr/bin/env bash
# A stable playtest server, apart from the checkout you work in: the built dist/ of a worktree of its own,
# served without hot reload, so the page changes only when you reload it after an update.
#
#   tools/playtest.sh serve           serve the playtest worktree's dist/ at http://localhost:5174
#   tools/playtest.sh update [REF]    move the worktree to REF (default main), build it; reload the tab after
#   tools/playtest.sh status          which commit the playtest server has, and what main has beyond it
#
# The port stays 5174: saves and preferences live in the browser per origin, so a new port would hide them.
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
wt=${PLAYTEST_DIR:-$(dirname "$repo")/freecol-online-worktrees/playtest}
port=${PLAYTEST_PORT:-5174}

ensure_worktree() {
  if [ ! -d "$wt" ]; then
    git -C "$repo" worktree add -q --detach "$wt" main
  fi
  # FreeCol's source at the commit the Engine needs: a shared clone, as a symlink breaks vp test.
  [ -d "$wt/freecol/.git" ] || git clone -q --shared "$repo/freecol" "$wt/freecol"
  git -C "$wt/freecol" fetch -q "$repo/freecol" 2>/dev/null || true
  git -C "$wt/freecol" checkout -q "$(cat "$wt/freecol.sha")"
  [ -d "$wt/ui/node_modules" ] || (cd "$wt" && ./dev.sh -C ui pnpm install --frozen-lockfile)
}

case "${1:-}" in
  serve)
    ensure_worktree
    [ -f "$wt/dist/index.html" ] || (cd "$wt" && ./dev.sh ./build.sh)
    echo "Playtest server: http://localhost:$port ($(git -C "$wt" log --oneline -1))"
    cd "$wt" && DEV_PORT=$port exec ./dev.sh -C ui pnpm exec vp preview --host 0.0.0.0 --port "$port" --strictPort
    ;;
  update)
    ref=${2:-main}
    ensure_worktree
    if [ -n "$(git -C "$wt" status --porcelain --untracked-files=no)" ]; then
      echo "The playtest worktree has local changes; not moving it." >&2
      exit 1
    fi
    sha=$(git -C "$repo" rev-parse --verify "$ref^{commit}")
    git -C "$wt" checkout -q --detach "$sha"
    ensure_worktree
    (cd "$wt" && ./dev.sh ./build.sh) > "$wt/.playtest-build.log" 2>&1 || {
      tail -30 "$wt/.playtest-build.log" >&2
      echo "Build failed; see $wt/.playtest-build.log" >&2
      exit 1
    }
    echo "Playtest updated to $(git -C "$wt" log --oneline -1). Reload the tab at http://localhost:$port to get it."
    ;;
  status)
    echo "Playtest: $(git -C "$wt" log --oneline -1)"
    git -C "$repo" log --oneline "$(git -C "$wt" rev-parse HEAD)..main" | sed 's/^/  not yet: /'
    ;;
  *)
    sed -n 2,9p "$0"
    exit 2
    ;;
esac

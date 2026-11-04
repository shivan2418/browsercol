#!/usr/bin/env bash
# Rebuild the Engine modules whenever its sources change, for `just dev`:
# Vite reloads the page once the new modules land in ui/generated. The dev
# image has no inotify, so this polls once a second for files newer than the
# last build. Run in the dev image, from the repo root.
set -uo pipefail
stamp=$(mktemp)
watched=(engine/src engine/patches engine/build.gradle engine/settings.gradle engine/gradle.properties)
echo "watch-engine: rebuilding the Engine when ${watched[*]} change"
while sleep 1; do
  [[ -n "$(find "${watched[@]}" -newer "$stamp" -type f -print -quit 2>/dev/null)" ]] || continue
  # Stamp before building, so an edit made during the build starts another.
  touch "$stamp"
  # Let a burst of saves settle before building.
  sleep 0.5
  echo "watch-engine: sources changed, rebuilding"
  start=$SECONDS
  # A daemon, unlike the one-off builds (gradle.properties): it lives as long
  # as the dev server's container, and a warm one rebuilds some 15% faster.
  if gradle -p engine --daemon --console=plain -q modules && tools/copy-modules.sh; then
    echo "watch-engine: Engine rebuilt in $((SECONDS - start))s; the page reloads"
  else
    echo "watch-engine: the Engine build failed; the page keeps the last good modules" >&2
  fi
done

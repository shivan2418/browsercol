#!/usr/bin/env bash
# Run a command inside the dev image with the repo mounted at /work.
# Usage: [DEV_VARIANT=web] [DEV_PORT=N] ./dev.sh [-C <dir relative to repo>] <command...>
# DEV_VARIANT=web selects docker/web.Dockerfile (Playwright and browsers).
# DEV_PORT=N publishes port N on localhost, for a server run in the container.
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
image=browsercol-dev
dockerfile=dev.Dockerfile
shm=()
if [[ "${DEV_VARIANT:-}" == web ]]; then
  image=browsercol-web; dockerfile=web.Dockerfile
  # Docker's default 64 MB /dev/shm can crash browsers, which Playwright's
  # Docker docs warn of. (Firefox's crash in #31 was a wasm bug in Firefox 142.)
  shm=(--shm-size=1g)
fi
workdir=/work
if [[ "${1:-}" == "-C" ]]; then workdir="/work/$2"; shift 2; fi
# The image is rebuilt when it is missing, when DEV_REBUILD=1, or when its Dockerfile changed since it was built.
sum=$(sha256sum "$repo/docker/$dockerfile" | cut -c1-16)
if ! docker image inspect "$image" >/dev/null 2>&1 || [[ "${DEV_REBUILD:-}" == 1 ]] \
  || [[ "$(docker image inspect -f '{{index .Config.Labels "dockerfile"}}' "$image" 2>/dev/null)" != "$sum" ]]; then
  docker build -q -t "$image" --label "dockerfile=$sum" -f "$repo/docker/$dockerfile" "$repo/docker" >/dev/null
fi
tty=(); [[ -t 0 && -t 1 ]] && tty=(-it)
ports=(); [[ -n "${DEV_PORT:-}" ]] && ports=(-p "127.0.0.1:$DEV_PORT:$DEV_PORT")
# A worktree or job clone may link freecol/ to the main checkout's clone,
# which lies outside the mounted repo: mount its target instead.
extra=()
if [[ -L "$repo/freecol" ]]; then
  extra=(-v "$(readlink -f "$repo/freecol"):/work/freecol:ro")
fi
# Rootless Docker: container root maps to the host user, so files stay ours.
# GITHUB_SHA and GITHUB_REF_NAME, when CI sets them, name the build the page
# shows (ui/scripts/build-id.ts); git in the container cannot tell it there.
# BUILD_COMMIT does the same locally: in a worktree, .git points outside /work.
# VITE_FEEDBACK_URL (the relay's URL, #369) and VITE_BETA_TAG reach the Vite build the same way; unset, they are
# left out of the container, so a local build has no relay.
BUILD_COMMIT=$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)
export BUILD_COMMIT
run=(docker run --rm ${tty[@]+"${tty[@]}"} ${shm[@]+"${shm[@]}"} ${ports[@]+"${ports[@]}"} -e HOME=/work/.cache/home
  -e GITHUB_SHA -e GITHUB_REF_NAME -e BUILD_COMMIT -e VITE_FEEDBACK_URL -e VITE_BETA_TAG
  -v "$repo:/work" ${extra[@]+"${extra[@]}"} -w "$workdir" "$image" "$@")
# Concurrent containers share the Gradle user home in /work/.cache/gradle, and
# Gradle gives up on its journal lock after 60 s before any build step runs
# (#219). That failure is transient and does nothing to the build, so a Gradle
# command is retried when, and only when, that message is its failure.
if [[ "${1:-}" != gradle ]]; then exec "${run[@]}"; fi
log=$(mktemp); trap 'rm -f "$log"' EXIT
for attempt in 1 2 3 4; do
  status=0
  "${run[@]}" 2>&1 | tee "$log" || status=${PIPESTATUS[0]}
  [[ $status -eq 0 ]] && exit 0
  grep -q 'Timeout waiting to lock .* It is currently in use by another process' "$log" || exit "$status"
  echo "dev.sh: Gradle cache lock timed out (attempt $attempt of 4), retrying" >&2
  sleep $((RANDOM % 10 + 5))
done
exit "$status"

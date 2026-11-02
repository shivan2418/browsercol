#!/usr/bin/env bash
# Run a command inside the dev image with the repo mounted at /work.
# Usage: [DEV_VARIANT=web] [DEV_PORT=N] ./dev.sh [-C <dir relative to repo>] <command...>
# DEV_VARIANT=web selects docker/web.Dockerfile (Playwright and browsers).
# DEV_PORT=N publishes port N on localhost, for a server run in the container.
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
image=freecol-online-dev
dockerfile=dev.Dockerfile
shm=()
if [[ "${DEV_VARIANT:-}" == web ]]; then
  image=freecol-online-web; dockerfile=web.Dockerfile
  # Docker's default 64 MB /dev/shm can crash browsers, which Playwright's
  # Docker docs warn of; a likely cause of Firefox's crash in #31.
  shm=(--shm-size=1g)
fi
workdir=/work
if [[ "${1:-}" == "-C" ]]; then workdir="/work/$2"; shift 2; fi
# Inside an agent sandbox (already this image, no Docker): run directly.
if [[ -n "${FREECOL_SANDBOX:-}" ]]; then
  cd "$repo${workdir#/work}" && exec "$@"
fi
if ! docker image inspect "$image" >/dev/null 2>&1 || [[ "${DEV_REBUILD:-}" == 1 ]]; then
  docker build -q -t "$image" -f "$repo/docker/$dockerfile" "$repo/docker" >/dev/null
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
exec docker run --rm "${tty[@]}" "${shm[@]}" "${ports[@]}" -e HOME=/work/.cache/home \
  -v "$repo:/work" "${extra[@]}" -w "$workdir" "$image" "$@"

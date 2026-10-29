#!/usr/bin/env bash
# Run a command inside the dev image with the repo mounted at /work.
# Usage: ./dev.sh [-C <dir relative to repo>] <command...>
set -euo pipefail
repo="$(cd "$(dirname "$0")" && pwd)"
image=freecol-online-dev
workdir=/work
if [[ "${1:-}" == "-C" ]]; then workdir="/work/$2"; shift 2; fi
# Inside an agent sandbox (already this image, no Docker): run directly.
if [[ -n "${FREECOL_SANDBOX:-}" ]]; then
  cd "$repo${workdir#/work}" && exec "$@"
fi
if ! docker image inspect "$image" >/dev/null 2>&1 || [[ "${DEV_REBUILD:-}" == 1 ]]; then
  docker build -q -t "$image" -f "$repo/docker/dev.Dockerfile" "$repo/docker" >/dev/null
fi
tty=(); [[ -t 0 && -t 1 ]] && tty=(-it)
# Rootless Docker: container root maps to the host user, so files stay ours.
exec docker run --rm "${tty[@]}" -e HOME=/work/.cache/home \
  -v "$repo:/work" -w "$workdir" "$image" "$@"

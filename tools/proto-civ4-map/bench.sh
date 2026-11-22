#!/usr/bin/env bash
# THROWAWAY (#405): run run.mjs in the browser image, capped to 4 CPUs so SwiftShader's software GL does not push
# the machine's load average up and make the measurement wait on itself. Usage: bench.sh shots|bench [out] [secs]
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
exec docker run --rm --cpus=4 --shm-size=1g -e HOME=/work/.cache/home -e ONLY -e TAG -v "$repo:/work" -w /work browsercol-web \
  node tools/proto-civ4-map/run.mjs "$@"

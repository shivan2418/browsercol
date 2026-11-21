#!/usr/bin/env bash
# Run N soaks in parallel from one origin save. Usage: batch.sh PREFIX N ORIGIN.SAV [soak.py args...]
set -uo pipefail
prefix=$1 n=$2 save=$3; shift 3
here=$(cd "$(dirname "$0")" && pwd)
for i in $(seq -w 1 "$n"); do
  "$here/soak.sh" "$here/runs/$prefix-$i" "$save" "$@" > "$here/runs/$prefix-$i.log" 2>&1 &
  sleep 2
done
wait

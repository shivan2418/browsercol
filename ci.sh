#!/usr/bin/env bash
# Run the whole suite on GitHub Actions instead of this machine: pushes HEAD
# to a throwaway ci/<sha> branch (which triggers the Suite workflow), waits
# for the run and exits with its result. Only committed work is tested.
# Usage: ./ci.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
sha=$(git rev-parse HEAD)
branch="ci/${sha:0:12}"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] \
  || echo "ci.sh: uncommitted changes are not tested, only HEAD ${sha:0:12}" >&2

git push -q -f origin "HEAD:refs/heads/$branch"
trap 'git push -q origin --delete "$branch" 2>/dev/null || true' EXIT

run=
for _ in $(seq 30); do
  run=$(gh run list --workflow suite.yml --branch "$branch" --commit "$sha" \
    --limit 1 --json databaseId --jq '.[0].databaseId // empty')
  [[ -n "$run" ]] && break
  sleep 5
done
[[ -n "$run" ]] || { echo "ci.sh: no Suite run started for $branch" >&2; exit 1; }
echo "ci.sh: $(gh run view "$run" --json url --jq .url)"

status=0
gh run watch "$run" --exit-status --interval 30 >/dev/null || status=$?
gh run view "$run" --json jobs \
  --jq '.jobs[].steps[] | select(.conclusion != "skipped") | "\(.conclusion)\t\(.name)"'
[[ $status == 0 ]] || gh run view "$run" --log-failed | tail -100
exit $status

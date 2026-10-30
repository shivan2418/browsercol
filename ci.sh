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

# Drop GitHub's "Create a pull request" hint for the new branch.
git push -q -f origin "HEAD:refs/heads/$branch" 2>&1 | { grep -v '^remote:' || true; } >&2
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

# Poll rather than `gh run watch`, which gives up on GitHub's API hiccups (502s).
until [[ "$(gh run view "$run" --json status --jq .status 2>/dev/null)" == completed ]]; do
  sleep 30
done
conclusion=$(gh run view "$run" --json conclusion --jq .conclusion)
# The summary is best effort: the API can fail here too.
gh run view "$run" --json jobs \
  --jq '.jobs[].steps[] | select(.conclusion != "skipped") | "\(.conclusion)\t\(.name)"' || true
if [[ $conclusion != success ]]; then
  { gh run view "$run" --log-failed | tail -100; } || true
  echo "ci.sh: $conclusion" >&2
  exit 1
fi

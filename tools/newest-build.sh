#!/usr/bin/env bash
# The highest build-N with a GitHub release, e.g. build-18; empty if there is none. The Site workflow deploys its
# game. GitHub's own "latest" release is not used: just after a release is made it can still name the one before
# (#501). Needs gh with GH_TOKEN, and GITHUB_REPOSITORY or a checkout whose remote is the repository.
set -euo pipefail
gh release list ${GITHUB_REPOSITORY:+--repo "$GITHUB_REPOSITORY"} --limit 100 --json tagName --jq '.[].tagName' \
  | sed -n 's/^build-\([0-9][0-9]*\)$/\1/p' | sort -n | tail -1 | sed 's/^./build-&/'

#!/usr/bin/env bash
# Deploy a commit to GitHub Pages as the next build: tags it build-N, one more
# than the highest build-* tag on origin, and pushes the tag, which starts the
# Pages workflow. The page then shows "build N · <commit>".
# Usage: tools/deploy.sh [commit]     (default: origin/main)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin main
commit=$(git rev-parse --verify "${1:-origin/main}^{commit}")
last=$(git ls-remote --tags origin 'refs/tags/build-*' \
  | sed -n 's|.*refs/tags/build-\([0-9]*\)$|\1|p' | sort -n | tail -1)
tag="build-$(( ${last:-0} + 1 ))"
git tag "$tag" "$commit"
git push -q origin "$tag"
echo "$tag -> ${commit:0:7}; follow it with: gh run list --workflow pages.yml -L 1"

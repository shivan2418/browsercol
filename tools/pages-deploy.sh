#!/usr/bin/env bash
# Deploy an uploaded Pages artifact, as actions/deploy-pages does, but with a build version of its own for each run
# (#501). deploy-pages names a deployment by the commit, and GitHub Pages keeps the first deployment of a version:
# when the deploy skill's changelog commit, deployed by its push around the last build's game, is then tagged as the
# new build, the new build's deployment of the same commit reported success and changed nothing.
# In a GitHub Actions job with `pages: write` and `id-token: write`. Usage: tools/pages-deploy.sh <artifact id>
# Writes page_url to $GITHUB_OUTPUT.
set -euo pipefail
artifact=${1:?the uploaded artifact id}
repo=${GITHUB_REPOSITORY:?}
version="$GITHUB_SHA-$GITHUB_RUN_ID-${GITHUB_RUN_ATTEMPT:-1}"
oidc=$(curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL" | jq -r .value)
created=$(gh api -X POST "repos/$repo/pages/deployments" \
  -F "artifact_id=$artifact" -f "pages_build_version=$version" -f "oidc_token=$oidc")
id=$(jq -r '.id // (.status_url | split("/") | last)' <<<"$created")
url=$(jq -r '.page_url' <<<"$created")
echo "Created deployment $id (version $version)"
for _ in $(seq 1 120); do
  status=$(gh api "repos/$repo/pages/deployments/$id" -q .status)
  case $status in
    succeed)
      echo "Deployed: $url"
      echo "page_url=$url" >> "${GITHUB_OUTPUT:-/dev/null}"
      exit 0
      ;;
    deployment_failed | deployment_content_failed | deployment_cancelled | deployment_lost)
      echo "Pages deployment $id: $status" >&2
      exit 1
      ;;
  esac
  sleep 5
done
echo "Pages deployment $id: still $status after 10 minutes" >&2
exit 1

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
if [ -z "$oidc" ] || [ "$oidc" = null ]; then
  echo "No OIDC token: the job needs id-token: write" >&2
  exit 1
fi
body=$(jq -n --argjson artifact "$artifact" --arg version "$version" --arg oidc "$oidc" \
  '{artifact_id: $artifact, pages_build_version: $version, oidc_token: $oidc}')
created=$(curl -sS -w '\n%{http_code}' -X POST "${GITHUB_API_URL:-https://api.github.com}/repos/$repo/pages/deployments" \
  -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' -d "$body")
code=$(tail -1 <<<"$created")
created=$(sed '$d' <<<"$created")
if [ "$code" != 200 ] && [ "$code" != 201 ]; then
  echo "Creating the Pages deployment failed (HTTP $code): $created" >&2
  exit 1
fi
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

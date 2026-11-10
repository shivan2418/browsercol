#!/usr/bin/env bash
# Build and deploy the feedback relay (template.yaml) to AWS, by hand.
# The bundle is built in the dev image and the SAM CLI runs from its own
# image (docker/sam.Dockerfile), so neither is installed on the host.
# Uses the host's AWS credentials, read-only from ~/.aws: set AWS_PROFILE
# and AWS_REGION as you would for the aws CLI (or AWS_ACCESS_KEY_ID etc.).
# Usage: relay/deploy.sh [extra sam deploy options, e.g. --parameter-overrides AllowedOrigin=...]
set -euo pipefail
relay="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$relay")"
stack="${RELAY_STACK:-browsercol-feedback-relay}"

"$repo/dev.sh" -C relay pnpm install --frozen-lockfile
"$repo/dev.sh" -C relay pnpm exec vp test
"$repo/dev.sh" -C relay pnpm exec vp build

image=browsercol-sam
sum=$(sha256sum "$repo/docker/sam.Dockerfile" | cut -c1-16)
if [[ "$(docker image inspect -f '{{index .Config.Labels "dockerfile"}}' "$image" 2>/dev/null)" != "$sum" ]]; then
  docker build -q -t "$image" --label "dockerfile=$sum" -f "$repo/docker/sam.Dockerfile" "$repo/docker" >/dev/null
fi
aws=(); [[ -d "$HOME/.aws" ]] && aws=(-v "$HOME/.aws:/root/.aws:ro")
tty=(); [[ -t 0 && -t 1 ]] && tty=(-it)
docker run --rm ${tty[@]+"${tty[@]}"} ${aws[@]+"${aws[@]}"} \
  -e AWS_PROFILE -e AWS_REGION -e AWS_DEFAULT_REGION \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  -e SAM_CLI_TELEMETRY=0 \
  -v "$relay:/relay" -w /relay "$image" \
  sam deploy --template-file template.yaml --stack-name "$stack" \
    --resolve-s3 --capabilities CAPABILITY_IAM --no-fail-on-empty-changeset "$@"

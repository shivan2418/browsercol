#!/usr/bin/env bash
# Start the built relay (dist/) under AWS's Lambda nodejs22 image, whose
# runtime and emulator load it as the real Lambda does, and send it one
# request from a foreign origin: it must answer 403. A bundle that Lambda
# cannot load made every request a 502 (#371), while plain Node loaded it.
# Needs no AWS credentials; the request never reaches S3.
set -euo pipefail
relay="$(cd "$(dirname "$0")" && pwd)"
name="relay-check-$$"
docker run -d --rm --name "$name" -p 127.0.0.1::8080 -v "$relay/dist:/var/task:ro" \
  -e BUCKET=check -e ALLOWED_ORIGIN=https://check.example -e AWS_REGION=us-east-1 \
  public.ecr.aws/lambda/nodejs:22 index.handler >/dev/null
trap 'docker stop "$name" >/dev/null 2>&1 || true' EXIT
port=$(docker port "$name" 8080/tcp | head -1 | sed 's/.*://')
answer=""
for _ in $(seq 1 30); do
  answer=$(curl -sS -X POST "http://127.0.0.1:$port/2015-03-31/functions/function/invocations" \
    -d '{"requestContext":{"http":{"method":"POST"}},"headers":{"origin":"https://elsewhere.example"},"body":"{}"}' \
    2>/dev/null) && break
  sleep 1
done
if [[ "$answer" != *'"statusCode":403'* ]]; then
  echo "relay bundle does not run under the Lambda runtime: ${answer:-no answer}" >&2
  docker logs "$name" 2>&1 | grep -iE "error" | head -3 >&2
  exit 1
fi
echo "relay bundle runs under the Lambda runtime"

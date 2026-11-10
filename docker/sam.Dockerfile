# The AWS SAM CLI, for relay/deploy.sh: deploys run in this image, so the
# CLI is never installed on the host. The relay's bundle is built in the dev
# image beforehand, so this one needs no Node.
FROM python:3.13-slim
ARG SAM_VERSION=1.170.0
RUN pip install --no-cache-dir "aws-sam-cli==${SAM_VERSION}"

# Browser image for the spike's measurement harness: Playwright with Chromium,
# Firefox and WebKit preinstalled, so nothing is installed on the host. Kept
# apart from dev.Dockerfile because the browsers add about 2 GB.
# Use it with: DEV_VARIANT=web ./dev.sh ...
ARG PW_VERSION=1.56.1
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble
ARG PW_VERSION
# The npm package must match the browsers baked into the base image.
RUN npm install -g playwright@${PW_VERSION}
ENV NODE_PATH=/usr/lib/node_modules \
    HOME=/work/.cache/home \
    npm_config_cache=/work/.cache/npm
WORKDIR /work

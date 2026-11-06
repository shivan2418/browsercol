# Browser image for the browser scripts: Playwright with Chromium,
# Firefox and WebKit preinstalled, so nothing is installed on the host. Kept
# apart from dev.Dockerfile because the browsers add about 2 GB.
# Use it with: DEV_VARIANT=web ./dev.sh ...
# 1.64.1 brings Firefox 157. 1.56.1's Firefox 142 has a wasm-gc bug (Mozilla
# bug 1992130, fixed in Firefox 145): the js-string builtin fromCharCodeArray
# sometimes garbled a string or overran a stack buffer, which crashed
# Firefox's content process and broke save loads (#31).
ARG PW_VERSION=1.64.1
FROM mcr.microsoft.com/playwright:v${PW_VERSION}-noble
ARG PW_VERSION
# The npm package must match the browsers baked into the base image.
RUN npm install -g playwright@${PW_VERSION}
ENV NODE_PATH=/usr/lib/node_modules \
    HOME=/work/.cache/home \
    npm_config_cache=/work/.cache/npm
WORKDIR /work

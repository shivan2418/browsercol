# Agent sandbox image: the dev image plus Playwright's Chromium and Firefox,
# so agents run the browser scripts (smoke, play, tileset) themselves. Build
# freecol-online-dev first (any ./dev.sh call does), then:
#   docker build -t freecol-online-agent -f docker/agent.Dockerfile docker
# Its playwright version must match web.Dockerfile's.
ARG BASE=freecol-online-dev
FROM ${BASE}
ARG PW_VERSION=1.56.1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g --prefix /usr/local playwright@${PW_VERSION} \
 && /usr/local/bin/playwright install --with-deps chromium firefox \
 && rm -rf /var/lib/apt/lists/* /root/.npm

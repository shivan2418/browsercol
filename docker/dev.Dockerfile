# Dev image for the spike: JDK, Gradle and Node, so nothing is installed on the host.
FROM eclipse-temurin:21-jdk-noble

ARG GRADLE_VERSION=9.8.2
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates xz-utils git \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip \
 && unzip -q /tmp/gradle.zip -d /opt && rm /tmp/gradle.zip \
 && ln -s /opt/gradle-${GRADLE_VERSION}/bin/gradle /usr/local/bin/gradle

ARG NODE_VERSION=24.18.0
RUN curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
  | tar -xJ -C /opt \
 && ln -s /opt/node-v${NODE_VERSION}-linux-x64/bin/* /usr/local/bin/

# pnpm, at the version ui/package.json's packageManager pins, through Node's Corepack.
ENV COREPACK_HOME=/work/.cache/corepack
RUN corepack enable pnpm --install-directory /usr/local/bin

ENV GRADLE_USER_HOME=/work/.cache/gradle \
    npm_config_cache=/work/.cache/npm \
    npm_config_store_dir=/work/.cache/pnpm-store
WORKDIR /work

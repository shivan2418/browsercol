# Dev image: JDK, Gradle and Node, so nothing is installed on the host.
# The base image is pinned by digest, so every machine and CI build with the
# same JDK patch release. To update: docker buildx imagetools inspect
# eclipse-temurin:21-jdk-noble, and put its Digest here.
FROM eclipse-temurin:21-jdk-noble@sha256:114cabb73033ca4ce7ceec3deb62396bc1b716282bae051ed3c1d82e38fcab2d

ARG GRADLE_VERSION=9.8.2
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates xz-utils git \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip \
 && unzip -q /tmp/gradle.zip -d /opt && rm /tmp/gradle.zip \
 && ln -s /opt/gradle-${GRADLE_VERSION}/bin/gradle /usr/local/bin/gradle

# Node's build for the image's architecture: x64 on CI, arm64 on Apple
# silicon, where an x64 Node under emulation crashes (exit 133).
ARG NODE_VERSION=24.18.0
ARG TARGETARCH
RUN arch=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64) \
 && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz \
  | tar -xJ -C /opt \
 && ln -s /opt/node-v${NODE_VERSION}-linux-${arch}/bin/* /usr/local/bin/

# pnpm, at the version ui/package.json's packageManager pins, through Node's Corepack.
ENV COREPACK_HOME=/work/.cache/corepack
RUN corepack enable pnpm --install-directory /usr/local/bin

ENV GRADLE_USER_HOME=/work/.cache/gradle \
    npm_config_cache=/work/.cache/npm \
    npm_config_store_dir=/work/.cache/pnpm-store
WORKDIR /work

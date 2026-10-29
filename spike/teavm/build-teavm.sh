#!/usr/bin/env bash
set -euo pipefail

SRC=/work/.cache/teavm-src
DST=/work/.cache/teavm-repo
URL=https://github.com/konsoletyper/teavm.git
PRS=(1300 1302 1304 1305)

if [ ! -d "$SRC/.git" ]; then
    git clone "$URL" "$SRC"
else
    mapfile -t PR_REFS < <(git -C "$SRC" for-each-ref --format='%(refname)' refs/remotes/pull | grep -vE '^refs/remotes/pull/[0-9]+/head$')
    for r in "${PR_REFS[@]}"; do git -C "$SRC" update-ref -d "$r"; done
fi
git -C "$SRC" fetch origin \
    '+refs/heads/master:refs/remotes/origin/master' \
    '+refs/pull/1300/head:refs/remotes/pull/1300/head' \
    '+refs/pull/1302/head:refs/remotes/pull/1302/head' \
    '+refs/pull/1304/head:refs/remotes/pull/1304/head' \
    '+refs/pull/1305/head:refs/remotes/pull/1305/head'

git -C "$SRC" merge --abort >/dev/null 2>&1 || true
git -C "$SRC" checkout -B master origin/master
echo "TeaVM master: $(git -C "$SRC" log -1 --format='%H %s' master)"

for n in "${PRS[@]}"; do
    ref="refs/remotes/pull/${n}/head"
    sha="$(git -C "$SRC" rev-parse "$ref")"
    echo "PR #${n}: $(git -C "$SRC" log -1 --format='%H %s' "$ref")"
    if ! git -C "$SRC" merge --no-edit "$ref"; then
        echo "ERROR: merging PR #${n} (${sha}) into master conflicted; aborting." >&2
        git -C "$SRC" merge --abort >/dev/null 2>&1 || true
        exit 1
    fi
done

mkdir -p "$DST"
(cd "$SRC" && gradle --no-daemon --no-configuration-cache \
    -Pteavm.localNodeJS=false \
    publishAllPublicationsToTeavmRepository)
rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC/build/staging-deploy/." "$DST/"

VERSION="$(sed -n 's/^teavm\.project\.version=//p' "$SRC/gradle.properties" | head -n 1)"
echo "Published TeaVM version: ${VERSION}"
ls "$DST/org/teavm"

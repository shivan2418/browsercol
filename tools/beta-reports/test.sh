#!/usr/bin/env bash
# Tests for pull.sh, reviewed.sh and delete.sh against fake-docker.sh, a
# local fake bucket: no AWS account is touched. The scripts run from a copy
# in a temp dir with a fake HOME, so neither the repo's beta-reports/ nor
# the real ~/.aws is read.
# Usage: tools/beta-reports/test.sh
set -euo pipefail
src="$(cd "$(dirname "$0")" && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

passed=0
ok() { passed=$((passed + 1)); echo "ok - $*"; }
no() { echo "FAIL - $*" >&2; [[ -f "$FAKE_LOG" ]] && sed 's/^/  log: /' "$FAKE_LOG" >&2; exit 1; }

export HOME="$tmp/home" FAKE_S3="$tmp/s3" FAKE_LOG="$tmp/docker.log"
unset BETA_AWS_PROFILE BETA_AWS_REGION BETA_BUCKET AWS_CONFIG_FILE FAKE_FAIL
mkdir -p "$tmp/bin" "$HOME/.aws" "$tmp/repo/tools"
cp "$src/fake-docker.sh" "$tmp/bin/docker"
export PATH="$tmp/bin:$PATH"
tools="$tmp/repo/tools/beta-reports"
cat >"$HOME/.aws/config" <<'EOF'
[profile browsercol-review]
region = eu-north-1

[profile work-thing]
sso_session = herasight
sso_account_id = 000000000000

[profile other-sso]
sso_session = elsewhere
EOF

# A fresh copy of the scripts and a bucket holding two inbox reports and one reviewed.
reset() {
  rm -rf "$tmp/repo/tools/beta-reports" "$tmp/repo/beta-reports" "$FAKE_S3" "$FAKE_LOG"
  cp -r "$src" "$tools"
  rm -f "$tools/config.env"
  local b="$FAKE_S3/beta-bucket"
  mkdir -p "$b/inbox/2026-11-01_R-ABCDE_bug_ships-sink" "$b/inbox/2026-11-02_R-23456_idea_more-horses" \
    "$b/reviewed/2026-10-01_R-ZZZZZ_other_hello"
  echo '{"kind":"bug"}' >"$b/inbox/2026-11-01_R-ABCDE_bug_ships-sink/report.json"
  echo 'log' >"$b/inbox/2026-11-01_R-ABCDE_bug_ships-sink/logs.txt"
  echo 'save' >"$b/inbox/2026-11-01_R-ABCDE_bug_ships-sink/save.fsg"
  echo '{"kind":"idea"}' >"$b/inbox/2026-11-02_R-23456_idea_more-horses/report.json"
  echo '{"kind":"other"}' >"$b/reviewed/2026-10-01_R-ZZZZZ_other_hello/report.json"
  : >"$FAKE_LOG"
}
configure() { export BETA_AWS_PROFILE=browsercol-review BETA_AWS_REGION=eu-north-1 BETA_BUCKET=beta-bucket; }
unconfigure() { unset BETA_AWS_PROFILE BETA_AWS_REGION BETA_BUCKET; }
docker_runs() { grep -c '^docker ' "$FAKE_LOG" || true; }
run() { out=$("$@" 2>&1) && rc=0 || rc=$?; }

# Missing config: says what to set, never runs docker.
reset; unconfigure
run "$tools/pull.sh"
[[ $rc == 1 && $out == *BETA_AWS_PROFILE=* && $out == *BETA_AWS_REGION=* && $out == *BETA_BUCKET=* && $out == *config.env* ]] || no "missing config: $out"
[[ $(docker_runs) == 0 ]] || no "missing config ran docker"
ok "missing config names all three settings and runs nothing"

BETA_BUCKET=beta-bucket run "$tools/pull.sh"
[[ $rc == 1 && $out == *BETA_AWS_PROFILE=* && $out != *BETA_BUCKET=* ]] || no "partial config: $out"
ok "partial config names only what is missing"

# config.env is the fallback; the environment wins over it.
reset; unconfigure
printf 'BETA_AWS_PROFILE=browsercol-review\nBETA_AWS_REGION=eu-north-1\nBETA_BUCKET=beta-bucket\n' >"$tools/config.env"
run "$tools/pull.sh"
[[ $rc == 0 ]] || no "config.env: $out"
grep -q 'AWS_PROFILE=browsercol-review' "$FAKE_LOG" || no "config.env profile not used"
ok "config.env supplies the settings"
: >"$FAKE_LOG"
BETA_BUCKET=nope-bucket run "$tools/pull.sh"
{ [[ $rc != 0 ]] && grep -q 's3://nope-bucket/inbox/' "$FAKE_LOG"; } || no "env did not override config.env: $out"
ok "the environment overrides config.env"

# Work profiles are refused before docker runs.
reset; configure
for p in default dev prod work-thing; do
  : >"$FAKE_LOG"
  BETA_AWS_PROFILE=$p run "$tools/pull.sh"
  [[ $rc == 1 && $out == *"refusing profile '$p'"* && $(docker_runs) == 0 ]] || no "profile $p not refused: $out"
done
ok "refuses default, dev, prod and the herasight SSO session"
BETA_AWS_PROFILE=other-sso run "$tools/pull.sh"
[[ $rc == 0 ]] || no "other SSO session refused: $out"
ok "allows a profile on another SSO session"
[[ $out != *sso_account_id* && $out != *000000000000* ]] || no "printed ~/.aws/config contents"
for bad in "BETA_BUCKET=Bad_Bucket" "BETA_AWS_REGION=x" "BETA_AWS_PROFILE=a;b"; do
  : >"$FAKE_LOG"
  env "$bad" "$tools/pull.sh" >/dev/null 2>&1 && no "accepted $bad"
  [[ $(docker_runs) == 0 ]] || no "$bad ran docker"
done
ok "rejects malformed bucket, region and profile"

# References are checked before any S3 path is built.
for bad in "" "R-ABCD" "R-ABCD0" "R-ABCDEF" "R-ABC/E" "R-../.." "X-ABCDE" "R-ABCDE;ls" "R-ABCDE "; do
  for cmd in reviewed delete; do
    reset; configure
    run "$tools/$cmd.sh" "$bad" </dev/null
    [[ $rc == 1 && $out == *"is not a report reference"* && $(docker_runs) == 0 ]] || no "$cmd accepted '$bad': $out"
  done
done
ok "rejects malformed references before running docker"

# Pull: inbox only, whole reports, incremental, as the host user.
reset; configure
run "$tools/pull.sh"
[[ $rc == 0 ]] || no "pull: $out"
local="$tmp/repo/beta-reports"
[[ -f "$local/inbox/2026-11-01_R-ABCDE_bug_ships-sink/save.fsg" && -f "$local/inbox/2026-11-01_R-ABCDE_bug_ships-sink/logs.txt" \
  && -f "$local/inbox/2026-11-02_R-23456_idea_more-horses/report.json" ]] || no "pull missed files"
[[ ! -e "$local/inbox/2026-10-01_R-ZZZZZ_other_hello" && -z "$(ls "$local/reviewed")" ]] || no "pull fetched reviewed/"
grep -q "run --rm --user $(id -u):$(id -g) " "$FAKE_LOG" || no "docker not run as the host user"
grep -q "sync s3://beta-bucket/inbox/ /reports/inbox/" "$FAKE_LOG" || no "no sync"
FAKE_ROOTLESS=1 run "$tools/pull.sh"
[[ $rc == 0 ]] || no "rootless pull: $out"
grep -q "run --rm -e HOME" "$FAKE_LOG" || no "rootless docker not run as the container's root"
[[ $(grep -c '^download:' "$FAKE_LOG") == 4 ]] || no "expected 4 downloads"
[[ $out == *2026-11-01_R-ABCDE_bug_ships-sink* ]] || no "pull did not list reports: $out"
ok "pull syncs inbox/ only, whole reports"
mkdir -p "$FAKE_S3/beta-bucket/inbox/2026-11-03_R-33333_bug_new"
echo '{}' >"$FAKE_S3/beta-bucket/inbox/2026-11-03_R-33333_bug_new/report.json"
: >"$FAKE_LOG"
run "$tools/pull.sh"
[[ $rc == 0 && $(grep -c '^download:' "$FAKE_LOG") == 1 ]] || no "second pull not incremental"
ok "a second pull downloads only the new report"

# Reviewed: moves bucket and local copy; lower case is fine.
run "$tools/reviewed.sh" r-abcde
[[ $rc == 0 ]] || no "reviewed: $out"
b="$FAKE_S3/beta-bucket"
[[ ! -e "$b/inbox/2026-11-01_R-ABCDE_bug_ships-sink" && -f "$b/reviewed/2026-11-01_R-ABCDE_bug_ships-sink/save.fsg" ]] || no "bucket not moved"
[[ ! -e "$local/inbox/2026-11-01_R-ABCDE_bug_ships-sink" && -f "$local/reviewed/2026-11-01_R-ABCDE_bug_ships-sink/save.fsg" ]] || no "local not moved"
grep -q 'mv --recursive s3://beta-bucket/inbox/2026-11-01_R-ABCDE_bug_ships-sink/ s3://beta-bucket/reviewed/2026-11-01_R-ABCDE_bug_ships-sink/' "$FAKE_LOG" || no "mv args"
ok "reviewed moves the report in the bucket and locally"
run "$tools/reviewed.sh" R-ABCDE
[[ $rc == 1 && $out == *"not in s3://beta-bucket/inbox/"* ]] || no "reviewed twice: $out"
run "$tools/reviewed.sh" R-99999
[[ $rc == 1 ]] || no "reviewed unknown"
ok "reviewed refuses a report not in inbox/"
run "$tools/reviewed.sh" R-23456
[[ $rc == 0 && $out == *"Moved s3://"* ]] || no "reviewed without... $out"
rm -rf "$local/inbox/2026-11-03_R-33333_bug_new"
run "$tools/reviewed.sh" R-33333
[[ $rc == 0 && $out == *"No local copy"* && -d "$b/reviewed/2026-11-03_R-33333_bug_new" ]] || no "reviewed with no local copy: $out"
ok "reviewed works without a local copy"

# Delete: shows the keys, asks, deletes from whichever prefix, and locally.
run "$tools/delete.sh" R-ABCDE <<<"n"
[[ $rc == 1 && $out == *"s3://beta-bucket/reviewed/2026-11-01_R-ABCDE_bug_ships-sink/save.fsg"* && $out == *"(local copy)"* ]] || no "delete listing: $out"
[[ -d "$b/reviewed/2026-11-01_R-ABCDE_bug_ships-sink" && -d "$local/reviewed/2026-11-01_R-ABCDE_bug_ships-sink" ]] || no "deleted on no"
grep -q ' rm ' "$FAKE_LOG" && no "ran rm on no"
ok "delete lists the keys and keeps everything on no"
run "$tools/delete.sh" R-ABCDE <<<"y"
[[ $rc == 0 && ! -e "$b/reviewed/2026-11-01_R-ABCDE_bug_ships-sink" && ! -e "$local/reviewed/2026-11-01_R-ABCDE_bug_ships-sink" ]] || no "delete y: $out"
ok "delete removes the report from the bucket and locally"
run "$tools/delete.sh" R-ZZZZZ <<<"y"
[[ $rc == 0 && ! -e "$b/reviewed/2026-10-01_R-ZZZZZ_other_hello" ]] || no "delete bucket-only: $out"
run "$tools/delete.sh" R-ABCDE <<<"y"
[[ $rc == 1 && $out == *"in neither"* ]] || no "delete gone: $out"
ok "delete handles bucket-only and already-gone reports"

# A failing S3 call stops the script.
FAKE_FAIL=1 run "$tools/reviewed.sh" R-33333
[[ $rc == 1 && $out == *"failed (exit 254)"* ]] || no "S3 error not reported: $out"
FAKE_FAIL=1 run "$tools/pull.sh"
[[ $rc != 0 ]] || no "pull ignored an S3 error"
ok "an S3 error stops the scripts"

echo "$passed passed"

#!/usr/bin/env bash
# A stand-in for `docker` in test.sh: checks the `docker run` that lib.sh's
# s3() makes, logs it, and plays the AWS CLI's `s3` commands against a
# directory, $FAKE_S3/<bucket>/<key>. It never talks to AWS.
set -euo pipefail
echo "docker $*" >>"$FAKE_LOG"
fail() { echo "fake docker: $*" >&2; exit 97; }

[[ ${1-} == run ]] || fail "only run is faked: $*"
shift
user='' reports='' config=0 envs=()
while [[ ${1-} == -* ]]; do
  case $1 in
    --rm) shift ;;
    --user) user=$2; shift 2 ;;
    -e) envs+=("${2%%=*}"); shift 2 ;;
    -w) shift 2 ;;
    -v)
      case $2 in
        *:/reports) reports=${2%:/reports} ;;
        "$HOME/.aws:/home/beta/.aws:ro") config=1 ;;
        *) fail "unexpected mount $2" ;;
      esac
      shift 2 ;;
    *) fail "unexpected option $1" ;;
  esac
done
[[ $user == "$(id -u):$(id -g)" ]] || fail "not run as the host user: '$user'"
((config)) || fail "$HOME/.aws is not mounted read-only"
[[ "${envs[*]}" == "HOME AWS_PROFILE AWS_REGION" ]] || fail "unexpected environment: ${envs[*]}"
[[ ${1-} == amazon/aws-cli:2.* ]] || fail "unpinned or unexpected image ${1-}"
[[ ${2-} == s3 ]] || fail "not an s3 command"
shift 2
[[ -n "${FAKE_FAIL-}" ]] && { echo "An error occurred (AccessDenied)" >&2; exit 254; }

args=()
for a in "$@"; do [[ $a == --only-show-errors ]] || args+=("$a"); done
set -- "${args[@]}"
cmd=$1; shift
recursive=0
[[ ${1-} == --recursive ]] && { recursive=1; shift; }
path() { # s3://bucket/key -> the fake's file; /reports/... -> the host dir
  case $1 in
    s3://*) local b=${1#s3://}; [[ -d "$FAKE_S3/${b%%/*}" ]] || { echo "NoSuchBucket" >&2; exit 254; }; echo "$FAKE_S3/$b" ;;
    /reports/*) echo "$reports/${1#/reports/}" ;;
    *) fail "unexpected path $1" ;;
  esac
}

case $cmd in
  ls)
    src=$(path "$1"); found=0
    if ((recursive)); then
      while IFS= read -r f; do
        found=1; printf '2026-11-11 10:00:00 %10d %s\n' "$(stat -c %s "$f")" "${f#"$FAKE_S3"/*/}"
      done < <(find "$src" -type f 2>/dev/null | sort)
    else
      for f in "$src"*; do
        [[ -e $f ]] || continue
        found=1
        if [[ -d $f ]]; then printf '%30s %s/\n' PRE "${f##*/}"; else printf '2026-11-11 10:00:00 %10d %s\n' "$(stat -c %s "$f")" "${f##*/}"; fi
      done
    fi
    ((found)) || exit 1 ;;
  sync)
    src=$(path "$1"); dst=$(path "$2")
    while IFS= read -r f; do
      rel=${f#"$src"}
      [[ -f "$dst$rel" ]] && cmp -s "$f" "$dst$rel" && continue
      mkdir -p "$(dirname "$dst$rel")"; cp "$f" "$dst$rel"
      echo "download: $rel" >>"$FAKE_LOG"
    done < <(find "$src" -type f 2>/dev/null | sort) ;;
  mv)
    ((recursive)) || fail "mv without --recursive"
    src=$(path "$1"); dst=$(path "$2")
    [[ -d $src ]] || exit 0
    mkdir -p "$(dirname "$dst")"; cp -r "$src" "$dst"; rm -r "$src" ;;
  rm)
    ((recursive)) || fail "rm without --recursive"
    rm -rf "$(path "$1")" ;;
  *) fail "unfaked s3 command $cmd" ;;
esac

# Shared by pull.sh, reviewed.sh and delete.sh (#372): the config, the
# profile guard, and `s3`, which runs the AWS CLI's own Docker image so
# nothing is installed on the host. Sourced, not run.
# shellcheck shell=bash

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
reports="$repo/beta-reports"
image=amazon/aws-cli:2.27.0

die() { echo "beta reports: $*" >&2; exit 1; }

# BETA_AWS_PROFILE, BETA_AWS_REGION and BETA_BUCKET: the environment wins,
# then tools/beta-reports/config.env (gitignored; see config.env.example).
load_config() {
  local profile=${BETA_AWS_PROFILE-} region=${BETA_AWS_REGION-} bucket=${BETA_BUCKET-}
  if [[ -f "$here/config.env" ]]; then
    # shellcheck source=/dev/null
    source "$here/config.env"
  fi
  BETA_AWS_PROFILE=${profile:-${BETA_AWS_PROFILE-}}
  BETA_AWS_REGION=${region:-${BETA_AWS_REGION-}}
  BETA_BUCKET=${bucket:-${BETA_BUCKET-}}
  local missing=()
  [[ -n "$BETA_AWS_PROFILE" ]] || missing+=("BETA_AWS_PROFILE=<the review profile in ~/.aws/config, e.g. browsercol-review>")
  [[ -n "$BETA_AWS_REGION" ]] || missing+=("BETA_AWS_REGION=<the bucket's region, e.g. eu-north-1>")
  [[ -n "$BETA_BUCKET" ]] || missing+=("BETA_BUCKET=<the relay's bucket name>")
  if ((${#missing[@]})); then
    {
      echo "beta reports: not configured. Set these in the environment or in"
      echo "  $here/config.env (copy config.env.example):"
      printf '  %s\n' "${missing[@]}"
      echo "See tools/beta-reports/README.md for the IAM user they need."
    } >&2
    exit 1
  fi
  [[ "$BETA_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "BETA_BUCKET '$BETA_BUCKET' is not a bucket name"
  [[ "$BETA_AWS_REGION" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || die "BETA_AWS_REGION '$BETA_AWS_REGION' is not a region"
  [[ "$BETA_AWS_PROFILE" =~ ^[A-Za-z0-9_.-]+$ ]] || die "BETA_AWS_PROFILE '$BETA_AWS_PROFILE' is not a profile name"
  refuse_work_profiles
}

# BrowserCol never touches work's AWS accounts: refuse their profile names
# and any profile on the herasight SSO session. Reads only that one setting
# of ~/.aws/config, never ~/.aws/credentials.
refuse_work_profiles() {
  case "$BETA_AWS_PROFILE" in
    default | dev | prod) die "refusing profile '$BETA_AWS_PROFILE': it is not BrowserCol's. Use the review profile (README.md)." ;;
  esac
  local config="${AWS_CONFIG_FILE:-$HOME/.aws/config}"
  [[ -f "$config" ]] || return 0
  if awk -v want="profile $BETA_AWS_PROFILE" '
      /^[[:space:]]*\[/ { s = $0; gsub(/^[[:space:]]*\[[[:space:]]*|[[:space:]]*\][[:space:]]*$/, "", s); gsub(/[[:space:]]+/, " ", s); here = (s == want) }
      here && /^[[:space:]]*sso_session[[:space:]]*=/ { v = $0; sub(/^[^=]*=[[:space:]]*/, "", v); sub(/[[:space:]]*$/, "", v); if (tolower(v) == "herasight") found = 1 }
      END { exit !found }' "$config"; then
    die "refusing profile '$BETA_AWS_PROFILE': it uses the herasight SSO session. Use the review profile (README.md)."
  fi
}

# A report's reference, R-XXXXX, in the relay's alphabet (relay/src/reference.ts),
# upper-cased; anything else stops before it reaches an S3 path.
reference() {
  local ref=${1-}
  ref=${ref^^}
  [[ "$ref" =~ ^R-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$ ]] || die "'${1-}' is not a report reference (R-XXXXX)"
  echo "$ref"
}

# `aws s3 ...` in the image, as the host user so files it writes are ours.
# Only ~/.aws (read-only), the profile and the region go in.
s3() {
  mkdir -p "$reports/inbox" "$reports/reviewed"
  docker run --rm --user "$(id -u):$(id -g)" \
    -e HOME=/home/beta -v "$HOME/.aws:/home/beta/.aws:ro" \
    -e AWS_PROFILE="$BETA_AWS_PROFILE" -e AWS_REGION="$BETA_AWS_REGION" \
    -v "$reports:/reports" -w /reports \
    "$image" s3 "$@"
}

# The report folders (`<date>_R-XXXXX_<kind>_<slug>/`) under a bucket prefix
# whose name carries the reference, one per line. `s3 ls` exits 1 when the
# prefix is empty; that is no match, not an error.
find_folders() {
  local prefix=$1 ref=$2 out rc=0
  out=$(s3 ls "s3://$BETA_BUCKET/$prefix") || rc=$?
  ((rc == 0 || rc == 1)) || die "listing s3://$BETA_BUCKET/$prefix failed (exit $rc)"
  awk -v ref="_${ref}_" '$1 == "PRE" && index($2, ref) { print $2 }' <<<"$out"
}

# The local copy of a report under beta-reports/<dir>/, if there is one.
local_folders() {
  local dir=$1 ref=$2 f
  for f in "$reports/$dir"/*_"${ref}"_*/; do
    [[ -d "$f" ]] && echo "${f%/}"
  done
  return 0
}

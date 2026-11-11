#!/usr/bin/env bash
# Mark a beta report reviewed (#372): move its folder from inbox/ to
# reviewed/ in the bucket, where it expires 180 days later, and move the
# local copy from beta-reports/inbox/ to beta-reports/reviewed/.
# Usage: tools/beta-reports/reviewed.sh R-XXXXX   (or `just beta-reviewed R-XXXXX`)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
ref=$(reference "${1-}")
load_config

mapfile -t found < <(find_folders inbox/ "$ref")
case ${#found[@]} in
  0) die "$ref is not in s3://$BETA_BUCKET/inbox/ (already reviewed, deleted, or a typo?)" ;;
  1) ;;
  *) die "$ref matches more than one folder in inbox/: ${found[*]}" ;;
esac
folder=${found[0]}

# s3 mv copies each object and then deletes the original.
s3 mv --recursive "s3://$BETA_BUCKET/inbox/$folder" "s3://$BETA_BUCKET/reviewed/$folder" --only-show-errors
echo "Moved s3://$BETA_BUCKET/inbox/$folder to reviewed/"

mapfile -t mine < <(local_folders inbox "$ref")
if ((${#mine[@]} == 0)); then
  echo "No local copy in beta-reports/inbox/ to move."
else
  mv -- "${mine[@]}" "$reports/reviewed/"
  echo "Moved the local copy to beta-reports/reviewed/"
fi

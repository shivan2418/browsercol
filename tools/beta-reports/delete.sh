#!/usr/bin/env bash
# Delete a beta report for good (#372), on a tester's request: its folder in
# the bucket, under inbox/ or reviewed/, and the local copy. Lists the keys
# and asks first.
# Usage: tools/beta-reports/delete.sh R-XXXXX   (or `just beta-delete R-XXXXX`)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
ref=$(reference "${1-}")
load_config

prefixes=()
for dir in inbox/ reviewed/; do
  while IFS= read -r folder; do
    [[ -n "$folder" ]] && prefixes+=("$dir$folder")
  done < <(find_folders "$dir" "$ref")
done
mapfile -t mine < <(local_folders inbox "$ref"; local_folders reviewed "$ref")
((${#prefixes[@]} + ${#mine[@]})) || die "$ref is in neither the bucket nor beta-reports/"

echo "This deletes, and it cannot be undone:"
for prefix in "${prefixes[@]}"; do
  s3 ls --recursive "s3://$BETA_BUCKET/$prefix" | awk -v b="$BETA_BUCKET" '{ print "  s3://" b "/" $4 }'
done
for dir in "${mine[@]}"; do echo "  ${dir#"$repo/"}/ (local copy)"; done
read -r -p "Delete $ref? [y/N] " answer
[[ "$answer" == [yY] ]] || die "nothing deleted"

for prefix in "${prefixes[@]}"; do
  s3 rm --recursive "s3://$BETA_BUCKET/$prefix" --only-show-errors
done
((${#mine[@]} == 0)) || rm -rf -- "${mine[@]}"
echo "Deleted $ref."

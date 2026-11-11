#!/usr/bin/env bash
# Download new beta reports (#372): sync the bucket's inbox/ into the
# gitignored beta-reports/inbox/. Only files not here yet are fetched, and
# nothing local is deleted. The folder names carry date, reference, kind and
# title, so `ls beta-reports/inbox` is the index. Setup: README.md.
# Usage: tools/beta-reports/pull.sh   (or `just beta-pull`)
set -euo pipefail
source "$(dirname "$0")/lib.sh"
load_config

s3 sync "s3://$BETA_BUCKET/inbox/" /reports/inbox/ --only-show-errors
echo "Reports in beta-reports/inbox/:"
ls -1 "$reports/inbox"

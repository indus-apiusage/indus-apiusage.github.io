#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

npm run sync

if git diff --quiet -- docs/data/latest.json; then
  echo "No dashboard data changes detected."
  exit 0
fi

git config user.name "${GIT_COMMITTER_NAME:-github-actions[bot]}"
git config user.email "${GIT_COMMITTER_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
git add docs/data/latest.json
git commit -m "chore: refresh usage dashboard data"
git push

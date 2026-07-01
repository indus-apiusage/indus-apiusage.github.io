#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE_NAME="${SYNC_GIT_REMOTE_NAME:-origin}"
REMOTE_BRANCH="${SYNC_GIT_REMOTE_BRANCH:-$CURRENT_BRANCH}"
UPSTREAM_REF="${REMOTE_NAME}/${REMOTE_BRANCH}"

ensure_clean_worktree() {
  if [ -n "$(git status --porcelain)" ]; then
    echo "Refusing to sync because the working tree is not clean." >&2
    git status --short >&2
    exit 1
  fi
}

sync_with_remote() {
  local behind_count

  git fetch "$REMOTE_NAME" "$REMOTE_BRANCH"
  behind_count="$(git rev-list --count HEAD.."$UPSTREAM_REF")"

  if [ "$behind_count" -gt 0 ]; then
    echo "Remote branch ${UPSTREAM_REF} is ahead by ${behind_count} commit(s). Pulling with rebase."
    git pull --rebase "$REMOTE_NAME" "$REMOTE_BRANCH"
  fi
}

push_with_retry() {
  if git push "$REMOTE_NAME" "HEAD:${REMOTE_BRANCH}"; then
    return 0
  fi

  echo "Push failed after remote changed. Refreshing from ${UPSTREAM_REF} and retrying."
  sync_with_remote
  git push "$REMOTE_NAME" "HEAD:${REMOTE_BRANCH}"
}

ensure_clean_worktree
sync_with_remote

npm run sync

if git diff --quiet -- docs/data/latest.json; then
  echo "No dashboard data changes detected."
  exit 0
fi

git config user.name "${GIT_COMMITTER_NAME:-github-actions[bot]}"
git config user.email "${GIT_COMMITTER_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
git add docs/data/latest.json
git commit -m "chore: refresh usage dashboard data"
sync_with_remote
push_with_retry

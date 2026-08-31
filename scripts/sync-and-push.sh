#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${SYNC_ENV_FILE:-${ROOT_DIR}/work/sync.env}"
MODE="${1:-}"

if [ -n "$MODE" ] && [ "$MODE" != "--recover-pending-data" ]; then
  echo "Unknown sync mode: $MODE" >&2
  exit 2
fi

# App-initiated reconnects run this script directly rather than through the
# local-loop wrapper, so load the same 600-permission environment here too.
if [ -n "${SYNC_ENV_FILE:-}" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Configured sync environment file does not exist: $ENV_FILE" >&2
  exit 1
fi
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

configure_git_ssh() {
  local key_option=""

  if [ -n "${SYNC_GIT_SSH_KEY_PATH:-}" ]; then
    local quoted_key
    printf -v quoted_key '%q' "${SYNC_GIT_SSH_KEY_PATH}"
    key_option="-i ${quoted_key} -o IdentitiesOnly=yes"
  fi

  # Keep direct sync:publish calls on GitHub's SSH-over-443 path and prevent
  # a background process from waiting for interactive authentication.
  export GIT_SSH_COMMAND="ssh ${key_option} -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=accept-new -o HostName=ssh.github.com -p 443"
}

configure_git_ssh

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
REMOTE_NAME="${SYNC_GIT_REMOTE_NAME:-origin}"
REMOTE_BRANCH="${SYNC_GIT_REMOTE_BRANCH:-$CURRENT_BRANCH}"
UPSTREAM_REF="${REMOTE_NAME}/${REMOTE_BRANCH}"

run_git_with_retry() {
  local attempt=1 delay
  local max_attempts="${SYNC_GIT_RETRY_ATTEMPTS:-3}"

  if ! [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
    max_attempts=3
  fi

  while true; do
    if git "$@"; then
      return 0
    fi
    if [ "$attempt" -ge "$max_attempts" ]; then
      return 1
    fi

    delay=$((attempt * 5))
    echo "GitHub remote operation failed; retrying in ${delay}s (${attempt}/${max_attempts})."
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

dashboard_data_has_changes() {
  [ -n "$(git status --porcelain -- docs/data/latest.json docs/data/widget.json)" ]
}

has_only_pending_dashboard_data() {
  local change path saw_dashboard_data=0

  while IFS= read -r change; do
    [ -n "$change" ] || continue
    path="${change:3}"
    case "$path" in
      docs/data/latest.json|docs/data/widget.json)
        saw_dashboard_data=1
        ;;
      *)
        return 1
        ;;
    esac
  done < <(git status --porcelain --untracked-files=all)

  [ "$saw_dashboard_data" -eq 1 ]
}

sync_with_remote() {
  local behind_count

  run_git_with_retry fetch "$REMOTE_NAME" "$REMOTE_BRANCH"
  behind_count="$(git rev-list --count HEAD.."$UPSTREAM_REF")"

  if [ "$behind_count" -gt 0 ]; then
    echo "Remote branch ${UPSTREAM_REF} is ahead by ${behind_count} commit(s). Pulling with rebase."
    run_git_with_retry pull --rebase "$REMOTE_NAME" "$REMOTE_BRANCH"
  fi
}

push_with_retry() {
  if run_git_with_retry push "$REMOTE_NAME" "HEAD:${REMOTE_BRANCH}"; then
    return 0
  fi

  echo "Push failed after remote changed. Refreshing from ${UPSTREAM_REF} and retrying."
  sync_with_remote
  run_git_with_retry push "$REMOTE_NAME" "HEAD:${REMOTE_BRANCH}"
}

commit_dashboard_data() {
  if ! dashboard_data_has_changes; then
    return 0
  fi

  git config user.name "${GIT_COMMITTER_NAME:-github-actions[bot]}"
  git config user.email "${GIT_COMMITTER_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}"
  git add docs/data/latest.json docs/data/widget.json
  git commit -m "chore: refresh usage dashboard data"
}

recover_pending_dashboard_data() {
  if [ -z "$(git status --porcelain)" ]; then
    echo "No pending dashboard data to recover."
    return 0
  fi

  if ! has_only_pending_dashboard_data; then
    echo "Refusing to recover pending data because the working tree has non-dashboard changes." >&2
    git status --short >&2
    return 1
  fi

  echo "Recovering dashboard data left by an interrupted sync cycle."
  commit_dashboard_data
  sync_with_remote
  push_with_retry
}

ensure_clean_worktree() {
  if [ -z "$(git status --porcelain)" ]; then
    return 0
  fi

  if ! has_only_pending_dashboard_data; then
    echo "Refusing to sync because the working tree is not clean." >&2
    git status --short >&2
    exit 1
  fi

  # A previous cycle may have been stopped after generating the public data
  # but before committing it. Recover only those known generated files.
  recover_pending_dashboard_data
}

if [ "$MODE" = "--recover-pending-data" ]; then
  recover_pending_dashboard_data
  exit 0
fi

ensure_clean_worktree
sync_with_remote

npm run sync

if ! dashboard_data_has_changes; then
  echo "No dashboard data changes detected."
  exit 0
fi

commit_dashboard_data
sync_with_remote
push_with_retry

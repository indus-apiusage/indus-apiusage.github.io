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

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || printf '%s' "${SYNC_GIT_REMOTE_BRANCH:-main}")"
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

file_hash() {
  local file_path="$1"
  if [ -f "$file_path" ]; then
    git hash-object "$file_path" 2>/dev/null || true
  fi
}

sync_with_remote() {
  run_git_with_retry fetch "$REMOTE_NAME" "$REMOTE_BRANCH"
}

dashboard_data_differs_from_ref() {
  local ref="$1"
  local path remote_hash local_hash

  for path in docs/data/latest.json docs/data/widget.json; do
    remote_hash="$(git rev-parse "${ref}:${path}" 2>/dev/null || true)"
    local_hash="$(file_hash "$path")"
    # A missing local snapshot is not a request to delete public data. It can
    # happen while a user is repairing the checkout, so leave that path at
    # the remote version and let the next successful crawl fill it locally.
    if [ -n "$local_hash" ] && [ "$local_hash" != "$remote_hash" ]; then
      return 0
    fi
  done

  return 1
}

create_dashboard_commit() {
  local base_ref="$1"
  local index_file tree commit

  index_file="$(mktemp "${TMPDIR:-/tmp}/foropencode-sync-index.XXXXXX")"

  if ! GIT_INDEX_FILE="$index_file" git read-tree "$base_ref"; then
    rm -f "$index_file" "$index_file.lock"
    return 1
  fi

  for path in docs/data/latest.json docs/data/widget.json; do
    if [ -e "$path" ]; then
      if ! GIT_INDEX_FILE="$index_file" git add -- "$path"; then
        rm -f "$index_file" "$index_file.lock"
        return 1
      fi
    fi
  done

  if ! tree="$(GIT_INDEX_FILE="$index_file" git write-tree)"; then
    rm -f "$index_file" "$index_file.lock"
    return 1
  fi

  if ! commit="$(printf '%s\n' 'chore: refresh usage dashboard data' | git \
      -c user.name="${GIT_COMMITTER_NAME:-github-actions[bot]}" \
      -c user.email="${GIT_COMMITTER_EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
      commit-tree "$tree" -p "$base_ref")"; then
    rm -f "$index_file" "$index_file.lock"
    return 1
  fi

  rm -f "$index_file" "$index_file.lock"
  printf '%s' "$commit"
}

publish_dashboard_data() {
  local attempt=1
  local max_attempts="${SYNC_GIT_RETRY_ATTEMPTS:-3}"
  local commit
  local delay

  if ! [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
    max_attempts=3
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    sync_with_remote
    if ! dashboard_data_differs_from_ref "$UPSTREAM_REF"; then
      echo "No dashboard data changes detected."
      return 0
    fi

    # Always use the fetched remote tip as the parent. This prevents a local
    # unpublished source commit from being pushed as a side effect of a data
    # refresh, while still allowing the two generated files to be published.
    if ! commit="$(create_dashboard_commit "$UPSTREAM_REF")"; then
      echo "Unable to create an isolated dashboard data commit." >&2
      return 1
    fi

    if git push "$REMOTE_NAME" "$commit:refs/heads/$REMOTE_BRANCH"; then
      echo "Published dashboard data commit ${commit}."
      return 0
    fi

    if [ "$attempt" -lt "$max_attempts" ]; then
      delay=$((attempt * 5))
      echo "Remote changed during publish; retrying with a fresh base in ${delay}s (${attempt}/${max_attempts})." >&2
      sleep "$delay"
    fi
    attempt=$((attempt + 1))
  done

  echo "Dashboard data push failed after ${max_attempts} attempt(s)." >&2
  return 1
}

if [ "$MODE" = "--recover-pending-data" ]; then
  publish_dashboard_data
  exit 0
fi

# The crawler does not read Git history. Fetch once, after it has generated the
# snapshots, so each cycle uses the freshest remote tip while avoiding a
# redundant network round-trip before the crawl.
npm run sync

publish_dashboard_data

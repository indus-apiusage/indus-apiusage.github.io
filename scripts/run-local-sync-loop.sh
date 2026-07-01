#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT_DIR}/work/sync-loop.pid"
LOG_FILE="${ROOT_DIR}/work/sync-loop.log"
ENV_FILE="${ROOT_DIR}/work/sync.env"

mkdir -p "${ROOT_DIR}/work"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

if [ -n "${SYNC_GIT_SSH_KEY_PATH:-}" ]; then
  export GIT_SSH_COMMAND="ssh -i '${SYNC_GIT_SSH_KEY_PATH}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
REMOTE_NAME="${SYNC_GIT_REMOTE_NAME:-origin}"
REMOTE_BRANCH="${SYNC_GIT_REMOTE_BRANCH:-$CURRENT_BRANCH}"
UPSTREAM_REF="${REMOTE_NAME}/${REMOTE_BRANCH}"

if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Sync loop is already running with PID ${EXISTING_PID}." >&2
    exit 1
  fi
fi

echo "$$" > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
}

trap cleanup EXIT INT TERM

log_message() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE"
}

prepare_sync_cycle() {
  local behind_count

  if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
    log_message "Skipping sync cycle because the working tree is not clean."
    git -C "$ROOT_DIR" status --short >>"$LOG_FILE" 2>&1
    return 1
  fi

  if ! git -C "$ROOT_DIR" fetch "$REMOTE_NAME" "$REMOTE_BRANCH" >>"$LOG_FILE" 2>&1; then
    log_message "Failed to fetch ${UPSTREAM_REF}."
    return 1
  fi

  behind_count="$(git -C "$ROOT_DIR" rev-list --count HEAD.."$UPSTREAM_REF")"
  if [ "$behind_count" -gt 0 ]; then
    log_message "Remote ${UPSTREAM_REF} is ahead by ${behind_count} commit(s). Pulling with rebase."
    if ! git -C "$ROOT_DIR" pull --rebase "$REMOTE_NAME" "$REMOTE_BRANCH" >>"$LOG_FILE" 2>&1; then
      log_message "Failed to pull ${UPSTREAM_REF} with rebase."
      return 1
    fi
  fi

  return 0
}

while true; do
  printf '\n' >>"$LOG_FILE"
  log_message "Starting sync cycle"

  if prepare_sync_cycle; then
    if bash "${ROOT_DIR}/scripts/run-local-sync.sh" >>"$LOG_FILE" 2>&1; then
      log_message "Sync cycle finished"
    else
      log_message "Sync cycle failed"
    fi
  else
    log_message "Sync cycle skipped"
  fi

  sleep 300
done

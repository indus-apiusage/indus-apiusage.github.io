#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT_DIR}/work/sync-loop.pid"
LOCK_DIR="${ROOT_DIR}/work/sync-loop.lock"
LOG_FILE="${ROOT_DIR}/work/sync-loop.log"
ENV_FILE="${SYNC_ENV_FILE:-${ROOT_DIR}/work/sync.env}"
SYNC_INTERVAL_SECONDS="${SYNC_INTERVAL_SECONDS:-300}"

normalize_interval() {
  if ! [[ "${SYNC_INTERVAL_SECONDS:-}" =~ ^[1-9][0-9]*$ ]]; then
    SYNC_INTERVAL_SECONDS=300
  fi
}

mkdir -p "${ROOT_DIR}/work"

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi
normalize_interval

if [ -n "${SYNC_GIT_SSH_KEY_PATH:-}" ]; then
  # GitHub's SSH endpoint on 443 is more reliable on networks that reset
  # ordinary SSH connections on port 22.
  export GIT_SSH_COMMAND="ssh -i '${SYNC_GIT_SSH_KEY_PATH}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o HostName=ssh.github.com -p 443"
fi

CURRENT_BRANCH="$(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
REMOTE_NAME="${SYNC_GIT_REMOTE_NAME:-origin}"
REMOTE_BRANCH="${SYNC_GIT_REMOTE_BRANCH:-$CURRENT_BRANCH}"
UPSTREAM_REF="${REMOTE_NAME}/${REMOTE_BRANCH}"

acquire_lock() {
  local existing_pid

  if mkdir "$LOCK_DIR" 2>/dev/null; then
    return 0
  fi

  existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Sync loop is already running with PID ${existing_pid}." >&2
    exit 1
  fi

  rm -rf "$LOCK_DIR"

  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Unable to acquire sync loop lock at ${LOCK_DIR}." >&2
    exit 1
  fi
}

acquire_lock

echo "$$" > "$LOCK_DIR/pid"
echo "$$" > "$PID_FILE"

ACTIVE_CHILD_PID=""

terminate_process_tree() {
  local pid="$1" child_pid child_pids

  # npm starts an intermediate shell before it reaches the Node crawler. Kill
  # descendants first so an interrupted cycle cannot outlive its loop parent.
  if command -v pgrep >/dev/null 2>&1; then
    child_pids="$(pgrep -P "$pid" 2>/dev/null || true)"
    for child_pid in $child_pids; do
      terminate_process_tree "$child_pid"
    done
  fi

  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  if [ -n "$ACTIVE_CHILD_PID" ] && kill -0 "$ACTIVE_CHILD_PID" 2>/dev/null; then
    terminate_process_tree "$ACTIVE_CHILD_PID"
    wait "$ACTIVE_CHILD_PID" 2>/dev/null || true
  fi

  # Never remove a lock or PID file claimed by a newer loop process.
  if [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$$" ]; then
    rm -rf "$LOCK_DIR"
  fi
  if [ "$(cat "$PID_FILE" 2>/dev/null || true)" = "$$" ]; then
    rm -f "$PID_FILE"
  fi
}

handle_signal() {
  printf '[%s] Received %s; stopping sync loop\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE"
  exit 0
}

trap cleanup EXIT
trap 'handle_signal SIGINT' INT
trap 'handle_signal SIGTERM' TERM

log_message() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >>"$LOG_FILE"
}

automatic_recovery_wait_seconds() {
  AUTH_SESSION_CACHE_FILE="${ROOT_DIR}/work/auth-session-cache.json" node 2>/dev/null <<'NODE' || printf '0'
const fs = require("fs");

const baseCooldownMs = 15 * 60 * 1000;
const maxCooldownMs = 6 * 60 * 60 * 1000;
let waitMs = 0;

try {
  const cache = JSON.parse(fs.readFileSync(process.env.AUTH_SESSION_CACHE_FILE, "utf8"));
  for (const entry of Object.values(cache?.accounts || {})) {
    if (entry?.reconnectReason !== "AUTH_AUTO_RECOVERY_COOLDOWN") continue;

    const lastAttempt = Date.parse(String(entry.lastAutomaticRecoveryAt || ""));
    if (!Number.isFinite(lastAttempt)) continue;

    const storedAttempts = Number(entry.automaticRecoveryAttempts);
    const attempts = Number.isInteger(storedAttempts) && storedAttempts > 0 ? storedAttempts : 1;
    const cooldownMs = Math.min(baseCooldownMs * (2 ** Math.max(0, attempts - 1)), maxCooldownMs);
    waitMs = Math.max(waitMs, lastAttempt + cooldownMs - Date.now());
  }
} catch {
  // A concurrent cache rotation can leave a brief partial read. The normal
  // interval handles that case without exposing any credential data.
}

process.stdout.write(String(Math.max(0, Math.ceil(waitMs / 1000))));
NODE
}

run_child() {
  "$@" &
  ACTIVE_CHILD_PID=$!
  local status=0

  if wait "$ACTIVE_CHILD_PID"; then
    status=0
  else
    status=$?
  fi
  ACTIVE_CHILD_PID=""
  return "$status"
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
  done < <(git -C "$ROOT_DIR" status --porcelain --untracked-files=all)

  [ "$saw_dashboard_data" -eq 1 ]
}

prepare_sync_cycle() {
  local behind_count

  if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
    if ! has_only_pending_dashboard_data; then
      log_message "Skipping sync cycle because the working tree is not clean."
      git -C "$ROOT_DIR" status --short >>"$LOG_FILE" 2>&1
      return 1
    fi

    log_message "Recovering pending dashboard data from an interrupted sync cycle."
    if ! run_child bash "${ROOT_DIR}/scripts/sync-and-push.sh" --recover-pending-data >>"$LOG_FILE" 2>&1; then
      log_message "Failed to recover pending dashboard data."
      return 1
    fi

    if [ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]; then
      log_message "Recovery finished but the working tree is still not clean."
      git -C "$ROOT_DIR" status --short >>"$LOG_FILE" 2>&1
      return 1
    fi
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
    if run_child bash "${ROOT_DIR}/scripts/run-local-sync.sh" >>"$LOG_FILE" 2>&1; then
      log_message "Sync cycle finished"
    else
      recovery_wait_seconds="$(automatic_recovery_wait_seconds)"
      if [[ "$recovery_wait_seconds" =~ ^[1-9][0-9]*$ ]] && [ "$recovery_wait_seconds" -gt "$SYNC_INTERVAL_SECONDS" ]; then
        log_message "Automatic password recovery is queued; deferring the next cycle for ${recovery_wait_seconds} second(s)."
        run_child sleep "$recovery_wait_seconds" || exit 0
        continue
      fi
      log_message "Sync cycle failed"
    fi
  else
    log_message "Sync cycle skipped"
  fi

  # The App may update this file while the loop is sleeping. Re-read it before
  # the next wait so an interval change takes effect without restarting data work.
  if [ -f "$ENV_FILE" ]; then
    # shellcheck disable=SC1090
    source "$ENV_FILE"
  fi
  normalize_interval
  run_child sleep "$SYNC_INTERVAL_SECONDS" || exit 0
done

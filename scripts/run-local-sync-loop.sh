#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ROOT_DIR}/work/sync-loop.pid"
LOG_FILE="${ROOT_DIR}/work/sync-loop.log"

mkdir -p "${ROOT_DIR}/work"
echo "$$" > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
}

trap cleanup EXIT INT TERM

while true; do
  {
    printf '\n[%s] Starting sync cycle\n' "$(date '+%Y-%m-%d %H:%M:%S')"
    bash "${ROOT_DIR}/scripts/run-local-sync.sh"
    printf '[%s] Sync cycle finished\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  } >>"$LOG_FILE" 2>&1 || {
    printf '[%s] Sync cycle failed\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG_FILE"
  }

  sleep 300
done

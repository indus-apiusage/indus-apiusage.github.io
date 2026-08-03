#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SYNC_ENV_FILE:-${ROOT_DIR}/work/sync.env}"

if [ -n "${SYNC_ENV_FILE:-}" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Configured sync environment file does not exist: $ENV_FILE" >&2
  exit 1
fi
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

cd "$ROOT_DIR"
exec node "${ROOT_DIR}/scripts/connect-account.mjs" "$@"

#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SYNC_ENV_FILE:-${ROOT_DIR}/work/sync.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing local sync env file: $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -n "${SYNC_GIT_SSH_KEY_PATH:-}" ]; then
  local_quoted_key=""
  printf -v local_quoted_key '%q' "${SYNC_GIT_SSH_KEY_PATH}"
  key_option="-i ${local_quoted_key} -o IdentitiesOnly=yes"
else
  key_option=""
fi

# Keep one-shot local runs on the same non-interactive SSH transport as the
# long-running loop.
export GIT_SSH_COMMAND="ssh ${key_option} -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 -o StrictHostKeyChecking=accept-new -o HostName=ssh.github.com -p 443"

cd "$ROOT_DIR"
npm run sync:publish

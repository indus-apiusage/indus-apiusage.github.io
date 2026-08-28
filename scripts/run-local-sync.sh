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
  # GitHub's SSH endpoint on 443 is more reliable on networks that reset
  # ordinary SSH connections on port 22.
  export GIT_SSH_COMMAND="ssh -i '${SYNC_GIT_SSH_KEY_PATH}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o HostName=ssh.github.com -p 443"
fi

cd "$ROOT_DIR"
npm run sync:publish

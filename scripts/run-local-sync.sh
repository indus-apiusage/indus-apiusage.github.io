#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/work/sync.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing local sync env file: $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

if [ -n "${SYNC_GIT_SSH_KEY_PATH:-}" ]; then
  export GIT_SSH_COMMAND="ssh -i '${SYNC_GIT_SSH_KEY_PATH}' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

cd "$ROOT_DIR"
npm run sync:publish

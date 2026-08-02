#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_SOURCE="${APP_SOURCE:-${ROOT_DIR}/dist/Indus Usage Console.app}"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/Applications}"
APP_DEST="${INSTALL_DIR}/Indus Usage Console.app"
WIDGET_ID="com.indus-apiusage.console.widget"

if [[ ! -d "${APP_SOURCE}" ]]; then
  echo "App not found: ${APP_SOURCE}" >&2
  echo "Run bash scripts/build-macos-app.sh first." >&2
  exit 1
fi

mkdir -p "${INSTALL_DIR}"
rm -rf "${APP_DEST}"
ditto "${APP_SOURCE}" "${APP_DEST}"

# Register the containing app and its embedded extension with PlugInKit.
pluginkit -a "${APP_DEST}" >/dev/null 2>&1 || true
open "${APP_DEST}"

echo "Installed: ${APP_DEST}"
echo
if pluginkit -m -A -D -v -i "${WIDGET_ID}" 2>/dev/null | rg -q "${WIDGET_ID}"; then
  echo "WidgetKit registration: detected"
  echo "Open the desktop's Edit Widgets panel and search for Indus API Usage."
else
  echo "WidgetKit registration: not detected"
  echo "If this build is ad-hoc signed, install a Developer ID or Apple Development signed build first."
  echo "Run: bash scripts/check-macos-widget.sh"
fi

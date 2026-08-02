#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${1:-${HOME}/Applications/Indus Usage Console.app}"
WIDGET_ID="com.indus-apiusage.console.widget"
WIDGET_PATH="${APP_PATH}/Contents/PlugIns/IndusUsageWidget.appex"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App not found: ${APP_PATH}" >&2
  exit 1
fi

if [[ ! -d "${WIDGET_PATH}" ]]; then
  echo "Widget extension not found: ${WIDGET_PATH}" >&2
  exit 1
fi

echo "App: ${APP_PATH}"
echo "Extension: ${WIDGET_PATH}"
echo
echo "--- Extension metadata ---"
plutil -p "${WIDGET_PATH}/Contents/Info.plist" | rg "CFBundleIdentifier|CFBundlePackageType|NSExtensionPointIdentifier|CFBundleShortVersionString"
echo
echo "--- Code signature ---"
codesign -dvv "${WIDGET_PATH}" 2>&1 | rg "Identifier=|TeamIdentifier=|Signature=|Authority=" || true
echo
echo "--- PlugInKit ---"
if pluginkit -m -A -D -v -i "${WIDGET_ID}" 2>/dev/null | rg -q "${WIDGET_ID}"; then
  pluginkit -m -A -D -v -i "${WIDGET_ID}"
  echo
  echo "Result: registered. The widget should be available in the macOS widget picker."
else
  echo "No registered extension matched ${WIDGET_ID}."
  echo "A valid Apple Development or Developer ID signature is usually required."
  exit 2
fi

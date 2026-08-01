#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/macos/IndusUsageConsole"
DIST_DIR="${ROOT_DIR}/dist"
APP_DIR="${DIST_DIR}/Indus Usage Console.app"
BIN_DIR="$(swift build --package-path "${PACKAGE_DIR}" -c release --show-bin-path)"

swift build --package-path "${PACKAGE_DIR}" -c release

rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources"
cp "${BIN_DIR}/IndusUsageConsole" "${APP_DIR}/Contents/MacOS/IndusUsageConsole"
cp "${PACKAGE_DIR}/Info.plist" "${APP_DIR}/Contents/Info.plist"
chmod 755 "${APP_DIR}/Contents/MacOS/IndusUsageConsole"

echo "Built: ${APP_DIR}"

if [ "${1:-}" = "--open" ]; then
  open "${APP_DIR}"
fi

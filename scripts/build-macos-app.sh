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

ICONSET_DIR="${DIST_DIR}/IndusUsageConsole.iconset"
rm -rf "${ICONSET_DIR}"
mkdir -p "${ICONSET_DIR}"
for size in 16 32 128 256 512; do
  double_size=$((size * 2))
  rsvg-convert -w "$size" -h "$size" "${PACKAGE_DIR}/Resources/AppIcon.svg" -o "${ICONSET_DIR}/icon_${size}x${size}.png"
  rsvg-convert -w "$double_size" -h "$double_size" "${PACKAGE_DIR}/Resources/AppIcon.svg" -o "${ICONSET_DIR}/icon_${size}x${size}@2x.png"
done
iconutil -c icns "${ICONSET_DIR}" -o "${APP_DIR}/Contents/Resources/AppIcon.icns"
rm -rf "${ICONSET_DIR}"

echo "Built: ${APP_DIR}"

if [ "${1:-}" = "--open" ]; then
  open "${APP_DIR}"
fi

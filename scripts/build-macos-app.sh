#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="${ROOT_DIR}/macos/IndusUsageConsole"
WIDGET_DIR="${ROOT_DIR}/macos/IndusUsageWidget"
DIST_DIR="${ROOT_DIR}/dist"
APP_DIR="${DIST_DIR}/Indus Usage Console.app"
APP_ENTITLEMENTS="${PACKAGE_DIR}/IndusUsageConsole.entitlements"
WIDGET_ENTITLEMENTS="${WIDGET_DIR}/IndusUsageWidget.entitlements"
BIN_DIR="$(swift build --package-path "${PACKAGE_DIR}" -c release --show-bin-path)"
WIDGET_BIN_DIR="${DIST_DIR}/IndusUsageWidget.build"
CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-}"
DEVELOPMENT_TEAM="${DEVELOPMENT_TEAM:-}"
APP_PROVISIONING_PROFILE="${APP_PROVISIONING_PROFILE:-}"
WIDGET_PROVISIONING_PROFILE="${WIDGET_PROVISIONING_PROFILE:-}"
CODESIGN_TIMESTAMP="${CODESIGN_TIMESTAMP:-required}"

if [[ -z "${CODESIGN_IDENTITY}" && -n "${DEVELOPMENT_TEAM}" ]]; then
  CODESIGN_IDENTITY="$( (security find-identity -v -p codesigning 2>/dev/null || true) \
    | sed -n 's/.*\"\(.*\)\".*/\1/p' \
    | rg "\\(${DEVELOPMENT_TEAM}\\)$" \
    | head -n 1 || true)"
fi

swift build --package-path "${PACKAGE_DIR}" -c release

rm -rf "${WIDGET_BIN_DIR}"
mkdir -p "${WIDGET_BIN_DIR}"
swiftc \
  -parse-as-library \
  -module-name IndusUsageWidget \
  -target "$(uname -m)-apple-macosx13.0" \
  -o "${WIDGET_BIN_DIR}/IndusUsageWidget" \
  "${PACKAGE_DIR}/Sources/IndusUsageConsole/WidgetSnapshotPayload.swift" \
  "${WIDGET_DIR}/Widget.swift" \
  -framework SwiftUI \
  -framework WidgetKit

rm -rf "${APP_DIR}"
mkdir -p "${APP_DIR}/Contents/MacOS" "${APP_DIR}/Contents/Resources" "${APP_DIR}/Contents/PlugIns/IndusUsageWidget.appex/Contents/MacOS"
cp "${BIN_DIR}/IndusUsageConsole" "${APP_DIR}/Contents/MacOS/IndusUsageConsole"
cp "${PACKAGE_DIR}/Info.plist" "${APP_DIR}/Contents/Info.plist"
chmod 755 "${APP_DIR}/Contents/MacOS/IndusUsageConsole"

cp "${WIDGET_BIN_DIR}/IndusUsageWidget" "${APP_DIR}/Contents/PlugIns/IndusUsageWidget.appex/Contents/MacOS/IndusUsageWidget"
cp "${WIDGET_DIR}/Info.plist" "${APP_DIR}/Contents/PlugIns/IndusUsageWidget.appex/Contents/Info.plist"
chmod 755 "${APP_DIR}/Contents/PlugIns/IndusUsageWidget.appex/Contents/MacOS/IndusUsageWidget"

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
rm -rf "${WIDGET_BIN_DIR}"

sign_bundle() {
  local bundle="$1"
  local entitlements="$2"

  if [[ -n "${CODESIGN_IDENTITY}" ]]; then
    local timestamp_args=()
    if [[ "${CODESIGN_TIMESTAMP}" == "none" ]]; then
      timestamp_args+=(--timestamp=none)
    else
      timestamp_args+=(--timestamp)
    fi
    codesign --force --options runtime "${timestamp_args[@]}" \
      --entitlements "${entitlements}" \
      --sign "${CODESIGN_IDENTITY}" "${bundle}" >/dev/null
  else
    # Ad-hoc signing is useful for local SwiftUI testing, but macOS may reject
    # an ad-hoc widget during PlugInKit registration.
    codesign --force --sign - "${bundle}" >/dev/null
  fi
}

install_profile() {
  local profile="$1"
  local destination="$2"

  if [[ -z "${profile}" ]]; then
    return 0
  fi
  if [[ ! -f "${profile}" ]]; then
    echo "Provisioning profile not found: ${profile}" >&2
    exit 1
  fi
  cp "${profile}" "${destination}"
}

if [[ -n "${CODESIGN_IDENTITY}" ]]; then
  install_profile "${WIDGET_PROVISIONING_PROFILE}" \
    "${APP_DIR}/Contents/PlugIns/IndusUsageWidget.appex/Contents/embedded.provisionprofile"
  install_profile "${APP_PROVISIONING_PROFILE}" \
    "${APP_DIR}/Contents/embedded.provisionprofile"
fi

# Sign the extension before the containing app so the app's resource seal
# includes the final extension signature.
sign_bundle "${APP_DIR}/Contents/PlugIns/IndusUsageWidget.appex" "${WIDGET_ENTITLEMENTS}"
sign_bundle "${APP_DIR}" "${APP_ENTITLEMENTS}"

echo "Built: ${APP_DIR}"

if [[ -z "${CODESIGN_IDENTITY}" ]]; then
  echo "Warning: no CODESIGN_IDENTITY was provided; this is an ad-hoc build." >&2
  echo "Warning: use a signed build before expecting the widget in macOS's widget picker." >&2
else
  echo "Signed with: ${CODESIGN_IDENTITY}"
  if [[ -z "${APP_PROVISIONING_PROFILE}" || -z "${WIDGET_PROVISIONING_PROFILE}" ]]; then
    echo "Warning: one or both provisioning profiles were omitted; PlugInKit registration may be unavailable." >&2
  fi
fi

if [ "${1:-}" = "--open" ]; then
  open "${APP_DIR}"
fi

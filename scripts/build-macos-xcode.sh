#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_DIR="${ROOT_DIR}/macos/IndusUsageConsole"
PROJECT="${PROJECT_DIR}/IndusUsageConsole.xcodeproj"
DERIVED_DATA="${ROOT_DIR}/dist/xcode-derived"
CONFIGURATION="${CONFIGURATION:-Debug}"

if [[ ! -d "${PROJECT}" ]]; then
  echo "Xcode project not found: ${PROJECT}" >&2
  exit 1
fi

xcodebuild_args=(
  -project "${PROJECT}"
  -scheme IndusUsageConsole
  -configuration "${CONFIGURATION}"
  -derivedDataPath "${DERIVED_DATA}"
  -allowProvisioningUpdates
  build
)

if [[ -n "${DEVELOPMENT_TEAM:-}" ]]; then
  xcodebuild_args+=("DEVELOPMENT_TEAM=${DEVELOPMENT_TEAM}")
fi

xcodebuild "${xcodebuild_args[@]}"

APP_PATH="${DERIVED_DATA}/Build/Products/${CONFIGURATION}/Indus Usage Console.app"
if [[ ! -d "${APP_PATH}" ]]; then
  echo "Xcode completed without producing ${APP_PATH}" >&2
  exit 1
fi

echo "Built and signed by Xcode: ${APP_PATH}"
echo "Widget extension: ${APP_PATH}/Contents/PlugIns/IndusUsageWidget.appex"

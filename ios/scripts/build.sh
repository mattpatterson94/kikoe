#!/bin/bash
# Release archive for the iOS app:
#   ios/scripts/build.sh <build-number> [--upload]
# Builds the web bundles the app embeds, syncs the version from package.json,
# then archives and exports with automatic signing. With --upload the export
# goes straight to App Store Connect, using the account signed in to Xcode.
set -euo pipefail
BUILD=${1:?usage: build.sh <build-number> [--upload]}
cd "$(dirname "$0")/../.."
npm run build
ios/scripts/sync-version.sh
ARCHIVE=ios/build/Kikoe.xcarchive
OPTIONS=ios/Config/ExportOptions.plist
if [[ ${2:-} == --upload ]]; then
  mkdir -p ios/build
  OPTIONS=ios/build/ExportOptions-upload.plist
  cp ios/Config/ExportOptions.plist "$OPTIONS"
  plutil -insert destination -string upload "$OPTIONS"
fi
xcodebuild archive -project ios/Kikoe.xcodeproj -scheme Kikoe -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath ios/build/export \
  -exportOptionsPlist "$OPTIONS" -allowProvisioningUpdates

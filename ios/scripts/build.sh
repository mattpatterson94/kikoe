#!/bin/bash
# Release archive for the iOS app:
#   ios/scripts/build.sh <build-number>
# Builds the web bundles the app embeds, syncs the version from package.json,
# then archives and exports with automatic signing.
set -euo pipefail
BUILD=${1:?usage: build.sh <build-number>}
cd "$(dirname "$0")/../.."
npm run build
ios/scripts/sync-version.sh
ARCHIVE=ios/build/Kikoe.xcarchive
xcodebuild archive -project ios/Kikoe.xcodeproj -scheme Kikoe -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath ios/build/export \
  -exportOptionsPlist ios/Config/ExportOptions.plist -allowProvisioningUpdates

#!/bin/bash
# Release archive for the native macOS app (KikoeMac, com.mattdoesdev.kikoe):
#   ios/scripts/build-mac.sh <build-number> [--upload]
# Same steps as build.sh: builds the web bundles, syncs the version from
# package.json, then archives and exports with automatic signing. With
# --upload the export goes straight to App Store Connect (TestFlight), using
# the account signed in to Xcode, or an App Store Connect API key when
# ASC_KEY_ID and ASC_ISSUER_ID are set (the key is read from
# ~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8, or ASC_KEY_PATH).
# Without --upload, the signed .pkg lands in ios/build/export-mac.
set -euo pipefail
BUILD=${1:?usage: build-mac.sh <build-number> [--upload]}
cd "$(dirname "$0")/../.."
npm run build
ios/scripts/sync-version.sh
ARCHIVE=ios/build/KikoeMac.xcarchive
OPTIONS=ios/Config/ExportOptions.plist
if [[ ${2:-} == --upload ]]; then
  mkdir -p ios/build
  OPTIONS=ios/build/ExportOptions-mac-upload.plist
  cp ios/Config/ExportOptions.plist "$OPTIONS"
  plutil -insert destination -string upload "$OPTIONS"
fi
AUTH=()
if [[ -n ${ASC_KEY_ID:-} && -n ${ASC_ISSUER_ID:-} ]]; then
  AUTH=(-authenticationKeyPath "${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8}"
    -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi
xcodebuild archive -project ios/Kikoe.xcodeproj -scheme KikoeMac -configuration Release \
  -destination 'generic/platform=macOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} CURRENT_PROJECT_VERSION="$BUILD"
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath ios/build/export-mac \
  -exportOptionsPlist "$OPTIONS" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

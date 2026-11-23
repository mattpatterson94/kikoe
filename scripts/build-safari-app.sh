#!/usr/bin/env bash
#
# Archive and export both Kikoe apps for App Store upload: the iOS/iPadOS app
# and the macOS app, which embeds the Safari Web Extension as an appex.
#
# Both come from the checked-in project ios/Kikoe.xcodeproj and share one
# bundle id (universal purchase), so this is just the two ios/scripts builds
# run back to back with the same build number. Pass --upload to send them
# straight to App Store Connect instead of exporting locally.
#
# Usage: scripts/build-safari-app.sh <build-number> [--upload]
set -euo pipefail

BUILD_NUMBER="${1:?build number required — must exceed the last one uploaded to App Store Connect}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$REPO/ios/scripts/build.sh" "$BUILD_NUMBER" ${2:+"$2"}
"$REPO/ios/scripts/build-mac.sh" "$BUILD_NUMBER" ${2:+"$2"}

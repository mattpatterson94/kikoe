#!/usr/bin/env bash
#
# Build the Kikoe apps (iOS/iPadOS and macOS) and export them for App Store upload.
#
# Both platforms come from the one checked-in project, ios/Kikoe.xcodeproj. The
# macOS app is a Mac Catalyst build of the native app with the Safari Web
# Extension embedded as an appex (its resources are copied from safari/ by a
# build phase), all under one bundle id so the two platforms are a single
# App Store Connect record. Version comes from package.json, team and bundle id
# from ios/Config/Kikoe.xcconfig; only the build number is passed in.
#
# Usage: scripts/build-safari-app.sh <build-number>
#
# Override the team with TEAM_ID if it ever changes.
set -euo pipefail

BUILD_NUMBER="${1:?build number required — must exceed the last one uploaded to App Store Connect}"
TEAM_ID="${TEAM_ID:-5UNQUGVP8A}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$REPO/package.json').version")"
OUT="$REPO/dist/safari-app"

# xcode-select often points at CommandLineTools, which has no xcodebuild. Prefer an explicit DEVELOPER_DIR, then the
# active selection if it's a full Xcode, then the newest Xcode in /Applications.
if [ -z "${DEVELOPER_DIR:-}" ]; then
  active="$(xcode-select -p 2>/dev/null || true)"
  if [ -x "$active/usr/bin/xcodebuild" ]; then
    export DEVELOPER_DIR="$active"
  else
    newest="$(ls -d /Applications/Xcode*.app 2>/dev/null | sort -V | tail -1)"
    [ -n "$newest" ] || { echo "No Xcode found in /Applications." >&2; exit 1; }
    export DEVELOPER_DIR="$newest/Contents/Developer"
  fi
fi

echo "→ Kikoe $VERSION (build $BUILD_NUMBER) — team $TEAM_ID"
echo "→ Using $DEVELOPER_DIR"

echo "→ Assembling extension bundles..."
( cd "$REPO" && npm run build )

echo "→ Syncing version into ios/Config/Version.xcconfig..."
"$REPO/ios/scripts/sync-version.sh"

rm -rf "$OUT"
mkdir -p "$OUT"

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>teamID</key>
    <string>$TEAM_ID</string>
    <key>signingStyle</key>
    <string>automatic</string>
    <key>destination</key>
    <string>export</string>
</dict>
</plist>
PLIST

archive() {
  local destination="$1" label="$2"
  echo "→ Archiving $label..."
  xcodebuild archive \
    -project "$REPO/ios/Kikoe.xcodeproj" \
    -scheme Kikoe \
    -configuration Release \
    -destination "$destination" \
    -archivePath "$OUT/Kikoe-$label.xcarchive" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER"
}

archive "generic/platform=iOS"                          ios
archive "generic/platform=macOS,variant=Mac Catalyst"   macos

"$REPO/scripts/export-safari-app.sh"

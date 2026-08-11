#!/usr/bin/env bash
#
# Build the Kikoe Safari containing apps and export them for App Store upload.
#
# Apple's converter regenerates the Xcode project from scratch every run (Kikoe/
# is gitignored and never committed), so it always comes back with converter
# defaults: MARKETING_VERSION 1.0, CURRENT_PROJECT_VERSION 1, and no team. Those
# have to be reapplied here or the upload gets rejected for a duplicate build.
#
# Usage: scripts/build-safari-app.sh <build-number>
#
# Override the identifiers with BUNDLE_ID / TEAM_ID if they ever change.
set -euo pipefail

BUILD_NUMBER="${1:?build number required — must exceed the last one uploaded to App Store Connect}"
BUNDLE_ID="${BUNDLE_ID:-com.mattdoesdev.kikoe}"
TEAM_ID="${TEAM_ID:-5UNQUGVP8A}"
MACOS_CATEGORY="${MACOS_CATEGORY:-public.app-category.education}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$REPO/package.json').version")"
OUT="$REPO/dist/safari-app"

# xcode-select often points at CommandLineTools, which has no xcodebuild and no
# safari-web-extension-converter. Prefer an explicit DEVELOPER_DIR, then the
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

echo "→ Kikoe $VERSION (build $BUILD_NUMBER) — $BUNDLE_ID — team $TEAM_ID"
echo "→ Using $DEVELOPER_DIR"

echo "→ Assembling extension bundles..."
( cd "$REPO" && npm run build )

echo "→ Converting safari/ to an Xcode project..."
rm -rf "$REPO/Kikoe"
xcrun safari-web-extension-converter "$REPO/safari/" \
  --app-name Kikoe \
  --bundle-identifier "$BUNDLE_ID" \
  --project-location "$REPO" \
  --no-open --no-prompt --force

echo "→ Customizing the containing app page..."
( cd "$REPO" && npm run safari:customize-app -- Kikoe )

echo "→ Applying version, build number, and team..."
PBXPROJ="$REPO/Kikoe/Kikoe.xcodeproj/project.pbxproj"
/usr/bin/sed -i '' \
  -e "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $VERSION;/g" \
  -e "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = $BUILD_NUMBER;/g" \
  -e "s/DEVELOPMENT_TEAM = \"\";/DEVELOPMENT_TEAM = $TEAM_ID;/g" \
  "$PBXPROJ"

# Two App Store keys the converter never writes. Both go into the per-target
# partial Info.plists, which Xcode merges with the keys it generates.
#
# LSApplicationCategoryType: the Mac App Store rejects a package without it.
# Nothing local catches this — archive and export both succeed and Transporter
# fails the upload with a 409.
#
# ITSAppUsesNonExemptEncryption: without it, App Store Connect asks the export
# compliance question on every single submission. Kikoe only ever talks HTTPS to
# the WaniKani API through OS frameworks, which is exempt, so this is false.
echo "→ Setting App Store Info.plist keys..."
set_plist_key() {
  local plist="$1" key="$2" type="$3" value="$4"
  plutil -remove "$key" "$plist" >/dev/null 2>&1 || true
  plutil -insert "$key" -"$type" "$value" "$plist"
  plutil -extract "$key" raw "$plist" >/dev/null || {
    echo "Failed to set $key in $plist" >&2
    exit 1
  }
}

set_plist_key "$REPO/Kikoe/macOS (App)/Info.plist" LSApplicationCategoryType string "$MACOS_CATEGORY"
set_plist_key "$REPO/Kikoe/macOS (App)/Info.plist" ITSAppUsesNonExemptEncryption bool NO
set_plist_key "$REPO/Kikoe/iOS (App)/Info.plist"   ITSAppUsesNonExemptEncryption bool NO

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
  local scheme="$1" platform="$2" label="$3"
  echo "→ Archiving $label..."
  xcodebuild archive \
    -project "$REPO/Kikoe/Kikoe.xcodeproj" \
    -scheme "$scheme" \
    -destination "$platform" \
    -archivePath "$OUT/Kikoe-$label.xcarchive" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER"
}

archive "Kikoe (iOS)"   "generic/platform=iOS"   ios
archive "Kikoe (macOS)" "generic/platform=macOS" macos

"$REPO/scripts/export-safari-app.sh"

#!/usr/bin/env bash
#
# Export the already-archived Kikoe apps into a .ipa and .pkg for Transporter.
#
# Split out from build-safari-app.sh so a signing or provisioning retry doesn't
# have to rebuild and re-archive from scratch.
#
# Usage: scripts/export-safari-app.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/dist/safari-app"

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

# Xcode's IPA packaging step runs Apple's openrsync, which passes
# --extended-attributes to a server-side rsync it resolves from PATH. Homebrew's
# rsync 3.x rejects that flag and the export dies with a bare "Copy failed" that
# names neither rsync nor PATH — it reads exactly like a signing failure. Shadow
# any third-party rsync with Apple's for the duration.
export PATH="/usr/bin:/bin:$PATH"

if ! security find-identity -v -p codesigning | grep -q "Apple Distribution"; then
  echo "No Apple Distribution certificate in the keychain." >&2
  echo "Xcode > Settings > Accounts > Manage Certificates > + > Apple Distribution" >&2
  exit 1
fi

if ! security find-identity -v | grep -q "3rd Party Mac Developer Installer"; then
  echo "No Mac Installer Distribution certificate — the macOS .pkg export will fail." >&2
  echo "Xcode > Settings > Accounts > Manage Certificates > + > Mac Installer Distribution" >&2
  exit 1
fi

export_one() {
  local label="$1"
  [ -d "$OUT/Kikoe-$label.xcarchive" ] || {
    echo "Missing $OUT/Kikoe-$label.xcarchive — run scripts/build-safari-app.sh first." >&2
    exit 1
  }
  echo "→ Exporting $label..."
  rm -rf "${OUT:?}/$label"
  xcodebuild -exportArchive \
    -archivePath "$OUT/Kikoe-$label.xcarchive" \
    -exportPath "$OUT/$label" \
    -exportOptionsPlist "$OUT/ExportOptions.plist" \
    -allowProvisioningUpdates
}

export_one ios
export_one macos

# Report the build numbers actually baked into the artifacts. Xcode's export
# step has manageAppVersionAndBuildNumber on by default: it asks App Store
# Connect whether the build number is taken and silently increments past it, per
# platform. So the number requested at build time is a floor, not a promise, and
# the two platforms routinely diverge.
echo ""
echo "Ready to upload with Transporter:"
for artifact in "$OUT/ios/Kikoe.ipa" "$OUT/macos/Kikoe.pkg"; do
  [ -f "$artifact" ] || continue
  staging="$(mktemp -d)"
  case "$artifact" in
    *.ipa) unzip -q "$artifact" -d "$staging"
           plist="$staging/Payload/Kikoe.app/Info.plist" ;;
    *.pkg) pkgutil --expand-full "$artifact" "$staging/x" >/dev/null 2>&1
           plist="$(find "$staging/x" -path "*Kikoe.app/Contents/Info.plist" | head -1)" ;;
  esac
  if [ -f "${plist:-}" ]; then
    printf '  %s — %s (build %s)\n' \
      "$artifact" \
      "$(plutil -extract CFBundleShortVersionString raw "$plist")" \
      "$(plutil -extract CFBundleVersion raw "$plist")"
  else
    printf '  %s\n' "$artifact"
  fi
  rm -rf "$staging"
done

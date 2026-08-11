#!/usr/bin/env bash
#
# Upload the Chrome extension zip to the Chrome Web Store.
#
# Uploads a new package as a draft by default. Submitting it for review is a
# separate, deliberate step — pass --publish, or click Submit in the dashboard.
#
# Usage:
#   scripts/publish-chrome.sh              # upload a draft
#   scripts/publish-chrome.sh --publish    # upload and submit for review
#
# Credentials come from the environment, never the repo. Put them in a file
# outside version control and source it first:
#
#   # ~/.config/kikoe/chrome-webstore.env
#   export CWS_CLIENT_ID=...
#   export CWS_CLIENT_SECRET=...
#   export CWS_REFRESH_TOKEN=...
#   export CWS_EXTENSION_ID=...        # the item ID from the dashboard URL
#
#   source ~/.config/kikoe/chrome-webstore.env && scripts/publish-chrome.sh
#
# Creating those once: enable the Chrome Web Store API in a Google Cloud
# project, make an OAuth client of type Desktop app, then exchange an
# authorization code for a refresh token with scope
# https://www.googleapis.com/auth/chromewebstore.
set -euo pipefail

PUBLISH=false
[ "${1:-}" = "--publish" ] && PUBLISH=true

for var in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_EXTENSION_ID; do
  [ -n "${!var:-}" ] || { echo "$var is not set — see the header of this script." >&2; exit 1; }
done

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(node -p "require('$REPO/package.json').version")"
ZIP="$REPO/dist/kikoe-chrome.zip"

echo "→ Packing kikoe-chrome.zip..."
( cd "$REPO" && npm run pack:chrome >/dev/null )

# A zip whose manifest disagrees with package.json means a stale build; the
# store would take it and ship the wrong version number.
ZIP_VERSION="$(unzip -p "$ZIP" manifest.json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).version")"
[ "$ZIP_VERSION" = "$VERSION" ] || {
  echo "Version mismatch: package.json is $VERSION but the zip manifest is $ZIP_VERSION." >&2
  echo "Run npm run build first." >&2
  exit 1
}
echo "→ Kikoe $VERSION — $(du -h "$ZIP" | cut -f1)"

json_field() { node -p "try{JSON.parse(require('fs').readFileSync(0,'utf8'))$1 ?? ''}catch(e){''}"; }

echo "→ Exchanging refresh token for an access token..."
TOKEN="$(curl -sS -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$CWS_CLIENT_ID" \
  -d "client_secret=$CWS_CLIENT_SECRET" \
  -d "refresh_token=$CWS_REFRESH_TOKEN" \
  -d grant_type=refresh_token | json_field '.access_token')"
[ -n "$TOKEN" ] || { echo "Failed to get an access token — check the credentials." >&2; exit 1; }

echo "→ Uploading package..."
UPLOAD="$(curl -sS -X PUT \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-api-version: 2" \
  -T "$ZIP" \
  "https://www.googleapis.com/upload/chromewebstore/v1.1/items/$CWS_EXTENSION_ID?uploadType=media")"

STATE="$(printf '%s' "$UPLOAD" | json_field '.uploadState')"
if [ "$STATE" != "SUCCESS" ]; then
  echo "Upload failed (uploadState=$STATE):" >&2
  printf '%s\n' "$UPLOAD" >&2
  exit 1
fi
echo "  uploaded as a draft"

if [ "$PUBLISH" != true ]; then
  echo ""
  echo "Draft uploaded. Review it in the dashboard, then submit:"
  echo "  https://chrome.google.com/webstore/devconsole/"
  echo "Or re-run with --publish to submit for review now."
  exit 0
fi

echo "→ Submitting for review..."
RESULT="$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-goog-api-version: 2" \
  -H "Content-Length: 0" \
  "https://www.googleapis.com/chromewebstore/v1.1/items/$CWS_EXTENSION_ID/publish")"

STATUS="$(printf '%s' "$RESULT" | json_field '.status?.join(", ")')"
case "$STATUS" in
  *OK*|"") echo "  submitted for review — status: ${STATUS:-OK}" ;;
  *)       echo "Publish returned: $STATUS" >&2
           printf '%s\n' "$RESULT" >&2
           exit 1 ;;
esac

echo ""
echo "Kikoe $VERSION submitted. Review typically takes a few days."

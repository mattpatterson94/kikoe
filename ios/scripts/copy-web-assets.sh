#!/bin/bash
# Copies the extension build output (from `npm run build`) into the app
# bundle as KikoeWeb/. Reads ../chrome — the bundles are identical across
# browser targets — and never writes to any generated folder.
set -euo pipefail
SRC="${SRCROOT}/../chrome"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/KikoeWeb"
for f in content.js bundle.js injected.js data/jmdict.json data/kanjidic2.json; do
  if [ ! -f "$SRC/$f" ]; then
    echo "error: $SRC/$f missing — run \`npm run build\` in the repo root first" >&2
    exit 1
  fi
done
mkdir -p "$DEST/data"
cp "$SRC/content.js" "$SRC/bundle.js" "$SRC/injected.js" "$DEST/"
cp "$SRC/data/jmdict.json" "$SRC/data/kanjidic2.json" "$DEST/data/"

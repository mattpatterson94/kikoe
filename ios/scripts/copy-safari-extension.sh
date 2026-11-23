#!/bin/bash
# Copies the assembled Safari Web Extension (from `npm run build`) into the
# appex's Resources. Reads ../safari and never writes to it.
set -euo pipefail
SRC="${SRCROOT}/../safari"
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
if [ ! -f "$SRC/manifest.json" ]; then
  echo "error: $SRC/manifest.json missing — run \`npm run build\` in the repo root first" >&2
  exit 1
fi
mkdir -p "$DEST"
rsync -a "$SRC/" "$DEST/"

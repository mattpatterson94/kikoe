#!/usr/bin/env bash
set -euo pipefail

DATA_VERSION="0.4.3"
DATA_BASE="https://raw.githubusercontent.com/okonomichiyaki/wanikani-voice-input/${DATA_VERSION}"

if command -v npm >/dev/null 2>&1; then
  echo "→ Installing npm dependencies..."
  npm install --silent
elif [ -x node_modules/.bin/esbuild ]; then
  echo "→ Using existing node_modules (npm not found)..."
else
  echo "npm is required to install dependencies before building." >&2
  exit 1
fi

ESBUILD="node_modules/.bin/esbuild"

echo "→ Bundling app (src/app.ts → bundle.js)..."
"$ESBUILD" src/app.ts \
  --bundle \
  --format=iife \
  --platform=browser \
  --outfile=bundle.js

echo "→ Bundling content script (extension/content.ts → content.js)..."
"$ESBUILD" extension/content.ts \
  --bundle \
  --format=iife \
  --platform=browser \
  --outfile=content.js

echo "→ Downloading data files (~12 MB, cached after first run)..."
mkdir -p data
[ -f data/jmdict.json ]    || curl -fsSL "$DATA_BASE/data/jmdict.json"    -o data/jmdict.json
[ -f data/kanjidic2.json ] || curl -fsSL "$DATA_BASE/data/kanjidic2.json" -o data/kanjidic2.json

echo "→ Trimming dictionary data to the fields kikoe actually reads..."
node scripts/trim-dictionary-data.js data/jmdict.json data/kanjidic2.json

echo "→ Assembling Chrome extension..."
mkdir -p chrome/data
cp bundle.js chrome/bundle.js
cp content.js chrome/content.js
cp extension/injected.js chrome/injected.js
cp extension/background.js chrome/background.js
cp extension/options.html chrome/options.html
cp extension/options.js chrome/options.js
cp data/jmdict.json chrome/data/jmdict.json
cp data/kanjidic2.json chrome/data/kanjidic2.json

echo "→ Assembling Firefox extension..."
mkdir -p firefox/data
cp bundle.js firefox/bundle.js
cp content.js firefox/content.js
cp extension/injected.js firefox/injected.js
cp extension/background.js firefox/background.js
cp extension/options.html firefox/options.html
cp extension/options.js firefox/options.js
cp data/jmdict.json firefox/data/jmdict.json
cp data/kanjidic2.json firefox/data/kanjidic2.json

echo "→ Assembling Safari Web Extension..."
mkdir -p safari/data safari/icons
cp extension/safari_manifest.json safari/manifest.json
cp bundle.js safari/bundle.js
cp content.js safari/content.js
cp extension/injected.js safari/injected.js
cp extension/background.js safari/background.js
cp extension/options.html safari/options.html
cp extension/options.js safari/options.js
cp chrome/icons/*.png safari/icons/
cp data/jmdict.json safari/data/jmdict.json
cp data/kanjidic2.json safari/data/kanjidic2.json

# Clean up root-level build artifacts
rm -f bundle.js content.js

echo ""
echo "Done."
echo "  Chrome:  load chrome/ in chrome://extensions (Developer mode → Load unpacked)"
echo "  Firefox: load firefox/manifest.json in about:debugging → This Firefox"
echo "  Safari:  convert safari/ with Xcode's Safari Web Extension converter"

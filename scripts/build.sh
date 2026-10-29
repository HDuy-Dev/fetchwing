#!/bin/sh
# Builds the Chrome Web Store upload: dist/fetchwing-<version>.zip
# The manifest "key" (stable dev ID) is removed; the Store assigns its own ID.
set -e
cd "$(dirname "$0")/.."

if grep -q "GOOGLE_CLIENT_ID = ''" src/config.js; then
  echo "Warning: GOOGLE_CLIENT_ID is empty, so Drive sync is off in this build" >&2
fi

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/fetchwing-$VERSION.zip"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$STAGE/assets"
cp -R src LICENSE "$STAGE/"
cp -R assets/icons "$STAGE/assets/"
rm -f "$STAGE/assets/icons/icon.svg"
node -e "
  const m = require('./manifest.json');
  delete m.key;
  require('fs').writeFileSync('$STAGE/manifest.json', JSON.stringify(m, null, 2) + '\n');
"
find "$STAGE" -name '.DS_Store' -delete

mkdir -p dist
rm -f "$OUT"
(cd "$STAGE" && zip -qr - .) > "$OUT"
echo "$OUT"

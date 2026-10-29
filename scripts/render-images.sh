#!/bin/sh
# Renders the extension icons and the Store promo tile with headless Chrome.
#   assets/icons/icon.svg      -> assets/icons/icon-{16,32,48,128}.png
#   docs/store/src/<name>.html -> docs/store/<name>.png
# Screenshots of the panel itself come from the e2e harness (see docs/PUBLISHING.md).
set -e
cd "$(dirname "$0")/.."

CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for px in 16 32 48 128; do
  # 128px keeps 16px of transparent padding per side (Store icon spec).
  art=$px; pad=0
  [ "$px" = 128 ] && art=96 && pad=16
  printf '<style>html,body{margin:0;background:transparent}</style><img src="file://%s/assets/icons/icon.svg" width="%s" height="%s" style="display:block;margin:%spx">' "$PWD" "$art" "$art" "$pad" > "$TMP/icon.html"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --force-device-scale-factor=1 --default-background-color=00000000 \
    --window-size="$px,$px" --screenshot="assets/icons/icon-$px.png" "file://$TMP/icon.html" 2>/dev/null
  echo "assets/icons/icon-$px.png"
done

"$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=1 --virtual-time-budget=2000 \
  --window-size=440,280 --screenshot=docs/store/promo-small.png "file://$PWD/docs/store/src/promo-small.html" 2>/dev/null
echo docs/store/promo-small.png

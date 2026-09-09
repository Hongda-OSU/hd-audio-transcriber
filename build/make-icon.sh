#!/bin/bash
# Rebuilds icon.png and icon.icns from icon-source.png.
# Needs ImageMagick (brew install imagemagick); iconutil ships with macOS.
set -euo pipefail
cd "$(dirname "$0")"

CANVAS=1024
CONTENT=880   # a circle reads smaller than the macOS squircle, so the art
              # takes a little more of the canvas than the usual 824

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# The trailing newline matters: without it `read` hits EOF, returns non-zero,
# and `set -e` kills the script before anything is written.
read -r W H < <(magick identify -format '%w %h\n' icon-source.png)
E=$((W - 1))
F=$((H - 1))

# Drop the source's white surround by flooding alpha in from the corners.
# Connectivity is what makes this safe: the crane's white feathers never touch
# the border, so they keep their pixels. A drawn circle cannot do this job —
# the disc in the art is neither perfectly round nor exactly centred.
magick icon-source.png -alpha set -fuzz 25% -fill none \
  -draw "alpha 0,0 floodfill" \
  -draw "alpha $E,0 floodfill" \
  -draw "alpha 0,$F floodfill" \
  -draw "alpha $E,$F floodfill" \
  "$TMP/cut.png"

# Flooding stops at the antialiased rim, leaving a hairline of near-white.
# Eroding the alpha channel eats it.
magick "$TMP/cut.png" -channel A -morphology Erode Disk:2 +channel "$TMP/clean.png"

# Fit inside CONTENT without forcing a square: the disc is slightly wider than
# it is tall, and stretching it to fit would show.
magick "$TMP/clean.png" -trim +repage -resize ${CONTENT}x${CONTENT} "$TMP/fitted.png"
magick "$TMP/fitted.png" -background none -gravity center \
  -extent ${CANVAS}x${CANVAS} +repage icon.png

space=$(magick identify -format '%[colorspace]' icon.png)
if [ "$space" != "sRGB" ]; then
  echo "✗ icon.png came out $space, expected sRGB — the artwork lost its colour" >&2
  exit 1
fi
corner=$(magick icon.png -format '%[fx:p{5,5}.a]' info:)
if [ "$corner" != "0" ]; then
  echo "✗ icon.png corner alpha is $corner, expected 0 — the white surround survived" >&2
  exit 1
fi

rm -rf icon.iconset && mkdir icon.iconset
for pair in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
            "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
            "512 512x512" "1024 512x512@2x"; do
  set -- $pair
  magick icon.png -resize "$1x$1" "icon.iconset/icon_$2.png"
done

iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
echo "✔ icon.png ($space, transparent) + icon.icns"

#!/bin/bash
# Rebuilds icon.png and icon.icns from icon-source.png.
# Needs ImageMagick (brew install imagemagick); iconutil ships with macOS.
set -euo pipefail
cd "$(dirname "$0")"

DIAMETER=880   # a circle reads smaller than the macOS squircle, so it takes
CANVAS=1024    # a little more of the canvas than the usual 824
PAD=$(((CANVAS - DIAMETER) / 2))
INSET=7        # mask radius pulled inside the art, dropping the source's
               # antialiased white rim instead of leaving a halo
R=$((DIAMETER / 2))

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

magick -size ${DIAMETER}x${DIAMETER} xc:black -fill white \
  -draw "circle $R,$R $R,$INSET" -alpha off "$TMP/mask.png"

magick icon-source.png -resize ${DIAMETER}x${DIAMETER}! "$TMP/art.png"

# Keep -composite and -border in separate invocations. Chained after a
# CopyOpacity composite, -border collapses the result to greyscale.
magick "$TMP/art.png" "$TMP/mask.png" -compose CopyOpacity -composite "$TMP/circle.png"
magick "$TMP/circle.png" -bordercolor none -border $PAD +repage icon.png

space=$(magick identify -format '%[colorspace]' icon.png)
if [ "$space" != "sRGB" ]; then
  echo "✗ icon.png came out $space, expected sRGB — the artwork lost its colour" >&2
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
echo "✔ icon.png ($space) + icon.icns"

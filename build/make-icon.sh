#!/bin/bash
# Rebuilds icon.png and icon.icns from icon-source.png.
# Needs ImageMagick (brew install imagemagick); iconutil ships with macOS.
set -euo pipefail
cd "$(dirname "$0")"

# Apple's app icon grid: the artwork fills 824 of a 1024 canvas and the rest is
# the margin every macOS icon leaves for itself. Filling the whole canvas makes
# the icon sit visibly larger than its neighbours in the Dock.
CANVAS=1024
BODY=824

# A squircle, not a circle and not a rounded rectangle. macOS masks app icons
# with a continuous curve — |x|^5 + |y|^5 = 1 — and next to it a circle reads
# as a coin and a roundrectangle's corner arcs read as flat.
EXPONENT=5
# The mask is drawn at twice the size and resized down: the expression is a
# hard inside/outside test, so the only antialiasing it gets is the downsample.
SUPERSAMPLE=2

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# Cover, not fit: a source that is not square is cropped rather than letterboxed
# with transparent bars the mask would then round off into nothing.
magick icon-source.png -resize "${BODY}x${BODY}^" -gravity center \
  -extent "${BODY}x${BODY}" +repage "$TMP/art.png"

big=$((BODY * SUPERSAMPLE))
half=$(echo "scale=4; ($big - 1) / 2" | bc)
magick -size "${big}x${big}" xc:black \
  -fx "(abs((i-$half)/$half)^$EXPONENT + abs((j-$half)/$half)^$EXPONENT) <= 1 ? 1 : 0" \
  -resize "${BODY}x${BODY}" "$TMP/mask.png"

# -alpha off first: CopyOpacity reads the mask's greyscale as the new alpha,
# and an existing alpha channel on either image silently wins otherwise.
magick "$TMP/art.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite \
  "$TMP/body.png"

magick "$TMP/body.png" -background none -gravity center \
  -extent "${CANVAS}x${CANVAS}" +repage icon.png

# --- checks -------------------------------------------------------------
# Every one of these has failed silently at some point. An icon that is wrong
# still builds, still installs, and looks fine until it is in the Dock next to
# something else.

fail() { echo "✗ $1" >&2; exit 1; }
alpha_at() { magick icon.png -format "%[fx:p{$1,$2}.a]" info:; }

space=$(magick identify -format '%[colorspace]' icon.png)
[ "$space" = "sRGB" ] || fail "icon.png came out $space, expected sRGB"

mid=$((CANVAS / 2))
inset=$(((CANVAS - BODY) / 2))

[ "$(alpha_at 5 5)" = "0" ] || fail "the canvas corner is not transparent"
[ "$(alpha_at $mid $mid)" = "1" ] || fail "the middle of the icon is transparent"
# Just inside the body's edge, halfway down: the flat part of the squircle.
[ "$(alpha_at $((inset + 4)) $mid)" = "1" ] || fail "the icon does not reach its left edge"
[ "$(alpha_at $((inset - 4)) $mid)" = "0" ] || fail "the icon spills past the 824 grid"

# What separates a squircle from a circle. At 45° the squircle reaches 0.87 of
# its half-width and a circle only 0.71, so this pixel is solid in one and
# empty in the other. Without it a circular mask passes every check above.
d=$(echo "scale=0; $BODY * 80 / 200" | bc)   # 0.80 of the half-width, diagonally
[ "$(alpha_at $((mid - d)) $((mid - d)))" = "1" ] \
  || fail "the corners are cut like a circle, not a squircle"
d=$(echo "scale=0; $BODY * 95 / 200" | bc)   # 0.95 — outside the squircle too
[ "$(alpha_at $((mid - d)) $((mid - d)))" = "0" ] || fail "the corners are not rounded at all"

rm -rf icon.iconset && mkdir icon.iconset
for pair in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
            "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
            "512 512x512" "1024 512x512@2x"; do
  set -- $pair
  magick icon.png -resize "$1x$1" "icon.iconset/icon_$2.png"
done

iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
echo "✔ icon.png (${BODY} squircle on ${CANVAS}) + icon.icns"

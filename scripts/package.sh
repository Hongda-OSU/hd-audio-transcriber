#!/usr/bin/env bash
# Builds HD Audio Transcriber.app into out/.
#
# Unsigned and un-notarized, both deliberately out of scope: this is a personal
# tool, and the machine that builds it is the machine that runs it. macOS will
# still refuse a double-click the first time — right-click → Open, once.
#
# No Python and no model go inside. The app finds whisperx in ~/.transcriber-env
# at run time, the same way it does from a terminal, so the bundle stays about
# the size of Electron itself rather than several gigabytes.

set -euo pipefail
cd "$(dirname "$0")/.."

# The icon is derived from build/icon-source.png and kept out of git, so a
# clean checkout has to make it before it can use it.
if [ ! -f build/icon.icns ]; then
  echo "build/icon.icns is missing; generating it…"
  bash build/make-icon.sh
fi

npm run build

# Everything the app does not read at run time. Source, tests and samples are
# the obvious ones; node_modules goes too, because nothing here has a runtime
# dependency — `dependencies` is empty and meant to stay that way.
npx electron-packager . \
  --platform=darwin \
  --arch="$(uname -m)" \
  --icon=build/icon.icns \
  --out=out \
  --overwrite \
  --prune=true \
  --app-bundle-id=com.hongda.hd-audio-transcriber \
  --app-category-type=public.app-category.productivity \
  --ignore='^/src($|/)' \
  --ignore='^/scripts($|/)' \
  --ignore='^/build($|/)' \
  --ignore='^/samples($|/)' \
  --ignore='^/out($|/)' \
  --ignore='^/\.claude($|/)' \
  --ignore='^/\.github($|/)' \
  --ignore='^/tsconfig\.json$' \
  --ignore='^/README\.md$' \
  --ignore='^/CLAUDE\.md$'

APP="out/HD Audio Transcriber-darwin-$(uname -m)/HD Audio Transcriber.app"

# Packager renames the binary and rewrites Info.plist, which leaves Electron's
# own signature describing a bundle that no longer exists — `codesign --verify`
# then reports "code has no resources but signature indicates they must be
# present". The app still launches, so this is repair rather than a
# requirement, but a broken signature is worse than an honest ad-hoc one.
#
# `--sign -` is ad-hoc: no certificate, no Developer ID, no notarization. Those
# stay out of scope; this only makes the bundle describe itself truthfully.
codesign --force --deep --sign - "$APP"
codesign --verify "$APP" && echo "Signature  ad-hoc, verified"

echo
echo "Built  $APP"
du -sh "$APP" | awk '{print "Size   " $1}'
echo
echo "First launch: right-click → Open. macOS blocks an unsigned app on a"
echo "plain double-click, and says nothing useful about why."

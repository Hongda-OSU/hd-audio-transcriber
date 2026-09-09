#!/bin/bash
# Development loop: tsc --watch in the background, the app in the foreground.
# main.ts watches dist/ and reloads (or relaunches) itself when either changes.
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build

npx tsc --watch --preserveWatchOutput &
TSC=$!
# Without this the compiler survives the app and keeps the terminal busy.
trap 'kill $TSC 2>/dev/null || true' EXIT

npx electron .

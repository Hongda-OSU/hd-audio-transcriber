#!/bin/bash
# =============================================================
#  Audio Transcriber · backend installer (setup_backend.sh)
#  Builds the whisperx environment the app spawns. Run once per machine:
#      bash setup_backend.sh
# =============================================================
set -euo pipefail

# Every version that matters is pinned here. whisperx especially: pinning the
# packages around it while leaving it loose meant pip picked a different
# whisperx per machine — one whose own requirements contradicted these pins.
WHISPERX_VERSION="3.7.5"
TORCH_VERSION="2.5.1"
PYANNOTE_VERSION="3.1.1"
SPEECHBRAIN_VERSION="0.5.16"
NUMPY_SPEC="numpy<2"

# whisperx 3.7.5 accepts 3.9 through 3.13.
PY_MIN_MINOR=9
PY_MAX_MINOR=13

VENV="${TRANSCRIBER_ENV:-$HOME/.transcriber-env}"

echo "=============================================="
echo "  Audio Transcriber · backend installer"
echo "=============================================="

# ---- 0. An environment may already exist under the older name ----
# The app searches ~/.transcriber-env then ~/whisperx-env, so a working
# environment under either name means there is nothing to build.
for existing in "$VENV" "$HOME/whisperx-env"; do
  if [ -x "$existing/bin/whisperx" ] &&
     "$existing/bin/python" -c "import whisperx, pyannote.audio" >/dev/null 2>&1; then
    echo "✔ A working environment already exists: $existing"
    "$existing/bin/python" - <<'PY'
import importlib.metadata as md
for p in ["whisperx", "torch", "pyannote.audio", "numpy"]:
    try:
        print(f"    {p:16} {md.version(p)}")
    except Exception:
        print(f"    {p:16} —")
PY
    echo ""
    echo "Nothing to do. Delete it first if you want a rebuild:"
    echo "    rm -rf \"$existing\""
    exit 0
  fi
done

# ---- 1. ffmpeg ----
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "▶ ffmpeg not found, installing with Homebrew..."
  if command -v brew >/dev/null 2>&1; then
    brew install ffmpeg
  else
    echo "✗ No Homebrew. Install it from https://brew.sh and re-run." >&2
    exit 1
  fi
else
  echo "✔ ffmpeg ready"
fi

# ---- 2. Pick an interpreter in range ----
# `python3` alone is whatever comes first on PATH, which differs per machine —
# and the version decides which whisperx pip is willing to install.
PYTHON=""
for candidate in python3.12 python3.11 python3.13 python3.10 python3.9 python3; do
  command -v "$candidate" >/dev/null 2>&1 || continue
  minor=$("$candidate" -c 'import sys; print(sys.version_info.minor)' 2>/dev/null) || continue
  major=$("$candidate" -c 'import sys; print(sys.version_info.major)' 2>/dev/null) || continue
  if [ "$major" = "3" ] && [ "$minor" -ge "$PY_MIN_MINOR" ] && [ "$minor" -le "$PY_MAX_MINOR" ]; then
    PYTHON=$(command -v "$candidate")
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "✗ Need Python 3.$PY_MIN_MINOR–3.$PY_MAX_MINOR; none found." >&2
  echo "  Install one:  brew install python@3.12" >&2
  exit 1
fi
echo "✔ Using $PYTHON ($("$PYTHON" --version 2>&1))"

# ---- 3. Virtualenv ----
# A half-built venv from an interrupted run would otherwise be treated as ready
# and installed on top of, which is how a broken environment survives a re-run.
if [ -d "$VENV" ] && [ ! -x "$VENV/bin/pip" ]; then
  echo "▶ $VENV exists but is incomplete — rebuilding"
  rm -rf "$VENV"
fi
if [ ! -d "$VENV" ]; then
  echo "▶ Creating $VENV"
  "$PYTHON" -m venv "$VENV"
else
  echo "✔ Reusing $VENV"
fi

"$VENV/bin/pip" install -q -U pip

# ---- 4. Install, in this order ----
# Old torch first (it clears the way for the pins below), then whisperx, then
# force the trio back down. pip will warn about conflicting requirements —
# whisperx declares newer torch/numpy/pyannote than these. That is expected:
# the combination below is the one that actually runs.
echo "▶ PyTorch $TORCH_VERSION..."
"$VENV/bin/pip" install "torch==$TORCH_VERSION" "torchaudio==$TORCH_VERSION"

echo "▶ whisperx $WHISPERX_VERSION..."
"$VENV/bin/pip" install "whisperx==$WHISPERX_VERSION"

echo "▶ pyannote / speechbrain / numpy..."
"$VENV/bin/pip" install \
  "pyannote.audio==$PYANNOTE_VERSION" \
  "speechbrain==$SPEECHBRAIN_VERSION" \
  "$NUMPY_SPEC"

# ---- 5. Verify, rather than announce ----
# The previous version printed a success banner and suggested the user run this
# check themselves. A script's own claim of success is not evidence.
echo "▶ Verifying..."
if ! "$VENV/bin/python" -c "import whisperx, pyannote.audio" >/dev/null 2>&1; then
  echo "✗ The environment does not import. Full error:" >&2
  "$VENV/bin/python" -c "import whisperx, pyannote.audio" || true
  exit 1
fi
if [ ! -x "$VENV/bin/whisperx" ]; then
  echo "✗ No whisperx executable in $VENV/bin" >&2
  exit 1
fi

"$VENV/bin/pip" freeze > "$VENV/requirements.lock.txt"

echo ""
echo "=============================================="
echo "✅ Backend ready: $VENV"
echo "=============================================="
"$VENV/bin/python" - <<'PY'
import importlib.metadata as md
for p in ["whisperx", "torch", "pyannote.audio", "speechbrain", "numpy"]:
    try:
        print(f"    {p:16} {md.version(p)}")
    except Exception:
        print(f"    {p:16} —")
PY
echo ""
echo "One thing left, and only for speaker separation:"
echo "  1. Accept the terms once on each page (same account as your token):"
echo "       https://huggingface.co/pyannote/speaker-diarization-3.1"
echo "       https://huggingface.co/pyannote/segmentation-3.0"
echo "  2. Create a read token at https://huggingface.co/settings/tokens"
echo "     and paste it into the app under Settings."
echo ""
echo "Exact versions recorded in $VENV/requirements.lock.txt"

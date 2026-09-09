#!/bin/bash
# =============================================================
#  Audio Transcriber · backend installer (setup_backend.sh)
#  Builds the whisperx environment the app spawns. Run once per machine:
#      bash setup_backend.sh
# =============================================================
set -euo pipefail

# whisperx is the only pin. Everything under it — torch, pyannote, numpy — is
# left to whisperx's own metadata. The previous script pinned those and forced
# them backwards, which is what blocked word alignment: transformers refuses to
# load .bin weights on torch < 2.6 (CVE-2025-32434), and without alignment
# whisperx labels a whole segment with one speaker, so a question and its answer
# come back as the same person.
WHISPERX_VERSION="3.8.6"

# whisperx 3.8.6 accepts 3.10 through 3.13.
PY_MIN_MINOR=10
PY_MAX_MINOR=13

VENV="${TRANSCRIBER_ENV:-$HOME/.transcriber-env}"

echo "=============================================="
echo "  Audio Transcriber · backend installer"
echo "=============================================="

# ---- 0. Is the target already built? ----
# Only the target counts. The app also falls back to ~/whisperx-env, but that
# one predates this script and must not stop a rebuild here.
if [ -x "$VENV/bin/whisperx" ] &&
   "$VENV/bin/python" -c "import whisperx, pyannote.audio" >/dev/null 2>&1; then
  existing="$VENV"
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

if [ -x "$HOME/whisperx-env/bin/whisperx" ]; then
  echo "ℹ An older environment sits at ~/whisperx-env. It is left alone, and the"
  echo "  app falls back to it if this one goes missing."
fi

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
find_python() {
  for candidate in python3.12 python3.11 python3.13 python3.10 python3; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    minor=$("$candidate" -c 'import sys; print(sys.version_info.minor)' 2>/dev/null) || continue
    major=$("$candidate" -c 'import sys; print(sys.version_info.major)' 2>/dev/null) || continue
    if [ "$major" = "3" ] && [ "$minor" -ge "$PY_MIN_MINOR" ] && [ "$minor" -le "$PY_MAX_MINOR" ]; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

PYTHON=$(find_python || true)

# macOS ships 3.9, which whisperx no longer accepts, so a fresh machine always
# lands here. ffmpeg above is installed the same way; stopping to hand the user
# one command would just be a slower version of this.
if [ -z "$PYTHON" ]; then
  echo "▶ No Python 3.$PY_MIN_MINOR–3.$PY_MAX_MINOR found, installing python@3.12..."
  if ! command -v brew >/dev/null 2>&1; then
    echo "✗ No Homebrew. Install it from https://brew.sh and re-run." >&2
    exit 1
  fi
  brew install python@3.12
  PATH="$(brew --prefix)/bin:$PATH"
  PYTHON=$(find_python || true)
fi

if [ -z "$PYTHON" ]; then
  echo "✗ Still no Python 3.$PY_MIN_MINOR–3.$PY_MAX_MINOR after installing." >&2
  echo "  Check that $(brew --prefix 2>/dev/null)/bin is on your PATH." >&2
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

# ---- 4. Install ----
# One command, one pin. pip resolves torch, pyannote and numpy from whisperx's
# own requirements, so nothing here can contradict them.
echo "▶ whisperx $WHISPERX_VERSION and its dependencies (several GB)..."
"$VENV/bin/pip" install "whisperx==$WHISPERX_VERSION"

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
for p in ["whisperx", "torch", "pyannote.audio", "numpy", "transformers"]:
    try:
        print(f"    {p:16} {md.version(p)}")
    except Exception:
        print(f"    {p:16} —")
PY
echo ""
echo "One thing left, and only for speaker separation:"
echo "  1. Accept the terms once, with the account your token belongs to:"
echo "       https://huggingface.co/pyannote/speaker-diarization-community-1"
echo "     (whisperx $WHISPERX_VERSION uses this model. The older"
echo "      speaker-diarization-3.1 is not what it asks for.)"
echo "  2. Create a read token at https://huggingface.co/settings/tokens"
echo "     and paste it into the app under Settings."
echo ""
echo "Exact versions recorded in $VENV/requirements.lock.txt"

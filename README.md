# 🎙️ hd-audio-transcriber

A macOS app that turns audio into a transcript with speaker labels and timestamps.

Drop in a file, get text. Edit the speaker names, export it.
Personal tool — not distributed.

## What it does

- **Transcribes** speech to text
- **Separates speakers** (`SPEAKER_00`, `SPEAKER_01`… — rename them to real names)
- **Keeps timestamps** for every segment
- **Exports** to txt, srt, vtt, json, or docx

## Requirements

- macOS
- [Node.js](https://nodejs.org)
- ffmpeg — `brew install ffmpeg` (the setup script installs it if missing)

## Setup

**1. Install the backend** (once per machine):

```bash
bash setup_backend.sh
```

This creates `~/.transcriber-env` with a pinned whisperx install.

**2. Accept the model terms** — click *Agree* once on each page:

- https://huggingface.co/pyannote/speaker-diarization-3.1
- https://huggingface.co/pyannote/segmentation-3.0

**3. Add a HuggingFace token** in the app's settings. It's saved to `config.json`, which stays out of git.

Check that it worked:

```bash
source ~/.transcriber-env/bin/activate && python -c 'import whisperx, pyannote.audio; print("OK")'
```

## Run

```bash
npm install
npm start
```

## How it works

The UI is Electron. The transcription is whisperx, running as a subprocess against the environment you installed above — no Python is bundled into the app.

```
Electron ──spawn──> ~/.transcriber-env/bin/whisperx
    ↑                         │
    └─── segments.json ◀──────┘
```

Every export format is generated from that JSON.

## Layout

```
main.js            Window, IPC, whisperx subprocess
preload.js         IPC bridge to the renderer
renderer/          UI: import, options, progress, results, export
lib/whisperx.js    Options → command → segments
lib/exporters.js   Segments → txt / srt / vtt / docx
setup_backend.sh   Backend installer
```

## Status

| | Milestone | Done |
|---|---|---|
| M1 | Window with drag-and-drop file import | ☐ |
| M2 | whisperx wired up — text, speakers, timestamps | ☐ |
| M3 | Options panel (language, model, speakers) + progress | ☐ |
| M4 | Rename speakers, export | ☐ |
| M5 | Hand the transcript off for cleanup | ☐ |
| M6 | Packaged `.app` | ☐ |

## Notes

- Don't upgrade the pinned versions in `setup_backend.sh` — torch, pyannote, and numpy only agree with each other at those exact versions.
- Speaker labels get fuzzy around question-and-answer boundaries. The cleanup pass fixes them.
- The time estimate is rough — whisperx doesn't report fine-grained progress.
- Long files are slow and memory-hungry. Stay plugged in, and consider `caffeinate -dimsu`.

Full spec lives in [Notion](https://app.notion.com/p/3cc60d3cf9f381ddbb55dbdcc0b9d87a).

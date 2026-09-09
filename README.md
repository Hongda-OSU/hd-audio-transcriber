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
- ffmpeg and Python 3.10–3.13 — the setup script installs both if missing
  (macOS ships Python 3.9, which whisperx no longer accepts)

## Setup

**1. Install the backend** (once per machine):

```bash
bash setup_backend.sh
```

This creates `~/.transcriber-env`. Only whisperx is pinned; torch, pyannote and
numpy come from whisperx's own requirements. Re-running it does nothing if the
environment is already built.

**2. Accept the model terms** — click *Agree* once, signed in as the account
your token belongs to:

- https://huggingface.co/pyannote/speaker-diarization-community-1

This is the model whisperx 3.8.6 asks for. Accepting the older
`speaker-diarization-3.1` instead still fails with a 403.

**3. Add a HuggingFace token** in the app's settings. It's saved to `config.json`, which stays out of git.

Check that it worked:

```bash
source ~/.transcriber-env/bin/activate && python -c 'import whisperx, pyannote.audio; print("OK")'
```

## Run

```bash
npm install     # once
npm start       # compiles TypeScript, then launches the app
```

`npm run dev` compiles, launches, and reloads on save — the renderer refreshes,
and a main-process change relaunches the app.

```bash
npm run build       # compile to dist/
npm run typecheck   # types only, no output
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
src/main.ts             Window, IPC, whisperx subprocess
src/preload.ts          IPC bridge to the renderer
src/types.d.ts          Shapes shared by main, preload and renderer
src/lib/probe.ts        ffprobe → duration and container format
src/lib/whisperx.ts     Options → command → segments
src/lib/exporters.ts    Segments → txt / srt / vtt / docx
src/renderer/           UI: import, options, progress, results, export
dist/                   Compiled output, git-ignored
setup_backend.sh        Backend installer
scripts/make-samples.sh Regenerates samples/ — test audio and its transcript
build/make-icon.sh      Regenerates icon.png and icon.icns from icon-source.png
```

`build/icon.icns` is not in git; M6 packaging runs `build/make-icon.sh` to
produce it. Keeping generated files in the repo lets them drift from the source
— an earlier icon shipped stale for several commits that way.

TypeScript compiles with `tsc` alone — no bundler. The renderer has no npm
dependencies, so there is nothing to bundle.

## Status

| | Milestone | Done |
|---|---|---|
| M1 | Window with drag-and-drop file import | ☑ |
| M2 | whisperx wired up — text, speakers, timestamps | ☑ |
| M3 | Options panel (language, model, speakers) + progress | ☐ |
| M4 | Rename speakers, export | ☐ |
| M5 | Hand the transcript off for cleanup | ☐ |
| M6 | Packaged `.app` | ☐ |

## Notes

- Pin only whisperx in `setup_backend.sh`. An earlier version pinned torch
  beneath it, and torch under 2.6 makes `transformers` refuse to load the
  alignment model (CVE-2025-32434). Without alignment whisperx gives each
  segment one speaker, so a question and its answer come back as one person.
- Speakers come from splitting whisperx's per-word labels, not from the one it
  puts on each segment — that one is a majority vote, so a question and the
  answer sharing a segment came back as the same person. On the test interview
  that turned 5 segments with a meaningless label into 12 with 12/12 correct.
- The time estimate is rough — whisperx doesn't report fine-grained progress.
- Long files are slow and memory-hungry. Stay plugged in, and consider `caffeinate -dimsu`.

Full spec lives in [Notion](https://app.notion.com/p/3cc60d3cf9f381ddbb55dbdcc0b9d87a).

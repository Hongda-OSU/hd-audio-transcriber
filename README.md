# 🎙️ HD Audio Transcriber

A macOS app that turns audio into a transcript with speaker labels and timestamps.

Drop in a file, get text. Edit the speaker names, export it.
Personal tool, MIT licensed.

## What it does

- **Transcribes** speech to text
- **Separates speakers** (`SPEAKER_00`, `SPEAKER_01`… — rename them to real names)
- **Keeps timestamps** for every segment
- **Exports** to txt, srt, vtt or json

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

While a transcription is running it does neither, and says
`[dev] reload deferred` until the run ends. A reload would destroy the promise
waiting on the result, and a relaunch would kill whisperx outright; an hour of
audio takes about two hours, which is a lot to lose to an edit.

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
src/lib/exporters.ts    Segments → txt, srt, vtt, json
src/lib/config.ts       The token and the remembered options
src/renderer/           UI: three tabs, described below
dist/                   Compiled output, git-ignored
setup_backend.sh        Backend installer
scripts/dev.sh          Compile, launch, reload on save
scripts/make-samples.sh Regenerates samples/ — test audio and its transcript
build/make-icon.sh      Regenerates icon.png and icon.icns from icon-source.png
```

`build/icon.icns` is not in git — run `build/make-icon.sh` before packaging.

## The window

Three tabs.

- **Transcribe** — drop a file, set language, model, speaker count and
  alignment, run it. Progress shows here, and the button becomes **Stop**.
- **Transcript** — the result, with the segment and speaker counts and how long
  the run took. One field per speaker renames every line at once; the export
  control writes the file out beside the recording.
- **Settings** — the HuggingFace token.

Every finished run keeps whisperx's own JSON in
`~/Library/Application Support/hd-audio-transcriber/transcripts/`. The
Transcript tab shows the path — click it to open the folder. ⌘R clears the
window, not the file.

Speaker names last as long as the window does; M5 makes them stick.

## Exports

| | |
|---|---|
| **txt** | Timestamp and speaker on one line, what they said on the next |
| **srt**, **vtt** | Subtitles |
| **json** | Segments with both the label and the name given to it |

A segment is one speaker's whole turn, which in an interview runs half a
minute — unreadable as a subtitle. srt and vtt cut it on the word timings
alignment produced, at most 42 columns or 7 seconds per cue, preferring to
break where a sentence ends. Turn alignment off and there are no word timings
to cut on, so each turn stays one long cue.

docx is not here. It is a zip of XML and would be the project's first runtime
dependency; M5 is where the transcript gets handed off, and that is the point
to decide what shape it needs.

## Status

| | Milestone | Done |
|---|---|---|
| M1 | Window with drag-and-drop file import | ☑ |
| M2 | whisperx wired up — text, speakers, timestamps | ☑ |
| M3 | Options panel (language, model, speakers, alignment) + progress | ☑ |
| M4 | Rename speakers, export | ☑ |
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
- The progress bar is real while transcribing — `--print_progress` reports a
  percentage — and shows only a phase name after that. Alignment and
  diarization report nothing, and diarization alone is about half the wall
  time, so anything moving there would be invented.
- Long files are slow and memory-hungry. Stay plugged in, and consider `caffeinate -dimsu`.

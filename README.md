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
`[dev] reload deferred` until the run ends.

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

Four tabs.

- **Transcribe** — drop a file, set language, model, speaker count and
  alignment, run it. Progress shows here, and the button becomes **Stop**.
- **Transcript** — the one you are working on, with the segment and speaker
  counts and how long the run took. One field per speaker renames every line at
  once; the export control writes the file out.
- **History** — every run ever finished. Open one and it comes back complete,
  export included, without touching the audio again. Disabled while the folder
  is empty.
- **Settings** — the HuggingFace token, where exports go, and where transcripts
  are kept. Both folders open in Finder when you click them.

Every finished run keeps whisperx's own JSON in
`~/Library/Application Support/hd-audio-transcriber/transcripts/`, with an
`index.json` beside it recording the audio, the settings and the runtime —
none of which whisperx's own output says. ⌘R clears the window, not the files.

Speaker names last as long as the window does.

## Exports

| | |
|---|---|
| **txt** | Timestamp and speaker on one line, what they said on the next |
| **srt**, **vtt** | Subtitles |
| **json** | Segments with both the label and the name given to it |

A segment is one speaker's whole turn, too long to read as a subtitle, so srt
and vtt cut it into cues of at most 42 columns or 7 seconds. With alignment off
there are no word timings to cut on and each turn stays one long cue.

docx comes with M5, where the transcript gets handed off.

## Status

| | Milestone | Done |
|---|---|---|
| M1 | Window with drag-and-drop file import | ☑ |
| M2 | whisperx wired up — text, speakers, timestamps | ☑ |
| M3 | Options panel (language, model, speakers, alignment) + progress | ☑ |
| M4 | Rename speakers, export | ☑ |
| M5 | Open a past run, hand the transcript off for cleanup | ☐ |
| M6 | Glossary and a queue — long recordings, run unattended | ☐ |
| M7 | Review tab — play the audio against the transcript | ☐ |
| M8 | Packaged `.app` | ☐ |

## Notes

- The progress bar shows a real percentage while transcribing, then only a
  phase name. Alignment and diarization report nothing, and diarization is
  about half the wall time — it is working, not stuck.
- Speaker labels flicker. On a real interview whisperx tore single characters
  out of the middle of words and gave them to the other person; a stretch of
  three words or less with no pause before it is given back. Anything longer is
  left alone, because a bound that could merge a question with its answer would
  cost more than the noise it cleans.
- Pin a speaker count only when you are sure of it. Pinning is absolute: name
  two on a recording with three people and the third is merged into the others,
  with no error and a transcript that reads as though it were right. Detect is
  the default for that reason.
- Long files are slow and memory-hungry. Stay plugged in. The app holds the
  machine awake for the length of a run, but closing the lid still sleeps.

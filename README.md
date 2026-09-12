# 🎙️ HD Audio Transcriber

A macOS app that turns audio into a transcript with speaker labels and timestamps.

Drop in a file, get text. Edit the speaker names, export it.
Personal tool, MIT licensed.

## What it does

- **Transcribes** speech to text
- **Separates speakers** (`SPEAKER_00`, `SPEAKER_01`… — rename them to real names)
- **Keeps timestamps** for every segment
- **Exports** to txt, srt, vtt, json, or a bundle to hand to an LLM for cleanup

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

`npm run dev` does the same and reloads on save.

## How it works

The UI is Electron. The transcription is whisperx, running as a subprocess against the environment you installed above — no Python is bundled into the app.

```
Electron ──spawn──> ~/.transcriber-env/bin/whisperx
    ↑                         │
    └─── segments.json ◀──────┘
```

Every export format is generated from that JSON.

## The window

Four tabs.

- **Transcribe** — drop a file, set language, model, speaker count and
  alignment, run it. Progress shows here, and the button becomes **Stop**.
- **Transcript** — the one you are working on, with the segment and speaker
  counts and how long the run took. One field per speaker renames every line at
  once, and the name is kept with the run; the export control writes the file
  out.
- **History** — every run ever finished. Open one and it comes back complete,
  export included, without touching the audio again. Delete puts it in the
  Trash, so it asks nothing first. Disabled while the folder is empty.
- **Settings** — the HuggingFace token, where exports go, and where transcripts
  are kept. Both folders open in Finder when you click them.

## Exports

| | |
|---|---|
| **txt** | Timestamp and speaker on one line, what they said on the next |
| **srt**, **vtt** | Subtitles |
| **json** | Segments with both the label and the name given to it |
| **cleanup bundle** | The draft plus the instructions for tidying it up, as one `.md` |

## Status

| | Milestone | Done |
|---|---|---|
| M1 | Window with drag-and-drop file import | ☑ |
| M2 | whisperx wired up — text, speakers, timestamps | ☑ |
| M3 | Options panel (language, model, speakers, alignment) + progress | ☑ |
| M4 | Rename speakers, export | ☑ |
| M5 | Open a past run, hand the transcript off for cleanup | ☑ |
| M6 | Glossary and a queue — long recordings, run unattended | ☐ |
| M7 | Review tab — play the audio against the transcript | ☐ |
| M8 | Packaged `.app` | ☐ |

## Notes

- **The percentage stops before the run does.** Alignment and diarization
  report nothing and take about half the time — it is working, not stuck.
- **Speaker boundaries are rough.** A few words either side of a turn often go
  to the wrong person. The cleanup step fixes them; nothing here can.
- **Leave the speaker count on Detect** unless you are certain. Pinning two on
  a recording with three merges the third in silently, and it reads as right.
- **Long files are slow.** Stay plugged in — the app blocks sleep, but closing
  the lid still sleeps.

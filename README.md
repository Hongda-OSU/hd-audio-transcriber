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

**2. Accept the model terms** — click *Agree* once, signed in as the account
your token belongs to:

- https://huggingface.co/pyannote/speaker-diarization-community-1

**3. Add a HuggingFace token** in the app's settings. It's saved to `config.json`, which stays out of git.

## Run

```bash
npm install     # once
npm start       # compiles TypeScript, then launches the app
npm run dev     # the same, reloading on save
npm run package # builds out/HD Audio Transcriber.app
```

## How it works

The UI is Electron. The transcription is whisperx, running as a subprocess against the environment you installed above — no Python is bundled into the app.

```
Electron ──spawn──> ~/.transcriber-env/bin/whisperx
    ↑                         │
    └─── segments.json ◀──────┘
```

Every export format is generated from that JSON.

## The window

- **Transcribe** — drop files, set the options, run. Drops always add, so the
  queue can be built one file at a time and reordered.
- **Transcript** — the run you are working on. A field per speaker renames
  every line at once. Export from here.
- **History** — every finished run, reopened without touching the audio again.
- **Settings** — token, glossary, and the two folders.

## Exports

| | |
|---|---|
| **txt** | Timestamp and speaker on one line, what they said on the next |
| **srt**, **vtt** | Subtitles |
| **json** | Segments with both the label and the name given to it |
| **cleanup bundle** | The draft plus the instructions for tidying it up, as one `.md` |

## Notes

- **The percentage stops before the run does.** Alignment and diarization
  report nothing and take about half the time — it is working, not stuck.
- **Speaker boundaries are rough.** A few words either side of a turn often go
  to the wrong person. The cleanup step fixes them; nothing here can.
- **Check every name the cleanup step gives back.** It is good at boundaries
  and punctuation and bad at proper nouns: on one interview it replaced a name
  the recording states three times, and listed the change against an original
  the recording never contained. The bundle now tells it to flag rather than
  rewrite, and to quote the transcript for every flag. Search the transcript
  for each quotation it hands back — there are only ever a few — because one
  that cannot be found is one it made up.
- **A glossary changes the whole transcript**, not only the names in it. It is
  offered to the model while it listens, so it shifts what the model hears
  everywhere. Leave it empty and nothing is passed.
- **Leave the speaker count on Detect** unless you are certain. Pinning two on
  a recording with three merges the third in silently, and it reads as right.
- **Long files are slow.** Stay plugged in and leave the lid up. The screen
  going dark is nothing — the app blocks the machine from sleeping, not the
  display. Closing the lid does sleep it, and nothing in an app can stop that.

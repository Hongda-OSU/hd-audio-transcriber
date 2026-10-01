# Guide

## How it works

The UI is Electron. The transcription is whisperx, running as a subprocess
against the environment `setup_backend.sh` installed — no Python is bundled
into the app.

```
Electron ──spawn──> ~/.transcriber-env/bin/whisperx
    ↑                         │
    └─── segments.json ◀──────┘
```

Every run saves that JSON, and every export format is generated from it, so
a transcript can be re-exported without touching the audio again.

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
| **srt**, **vtt** | Subtitles, cut to 42 columns or 7 seconds |
| **json** | Segments with both the label and the name given to it |
| **cleanup bundle** | The draft plus the instructions for tidying it up, as one `.md` |

## Notes

- **The percentage stops before the run does.** Alignment and diarization
  report nothing and take about half the time. Not stuck.
- **Speaker boundaries are rough.** A few words either side of a turn go to
  the wrong person. The cleanup step fixes them; nothing here can.
- **Check the names the cleanup step returns.** It is good at punctuation and
  bad at proper nouns: on one interview it renamed someone the recording names
  three times, and cited an original the recording never contained. Search the
  transcript for each quotation it gives you — one you cannot find is one it
  made up.
- **A glossary changes the whole transcript**, not only the names in it — it
  is offered to the model while it listens. Empty passes nothing.
- **Leave the speaker count on Detect** unless you are certain. Pin two on a
  recording with three and the third is merged in silently, reading as right.
- **Long files are slow.** Stay plugged in, lid up. A dark screen is fine —
  the app blocks sleep, not the display. Closing the lid sleeps it anyway.

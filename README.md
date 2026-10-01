# 🎙️ HD Audio Transcriber

A macOS app that turns a recording into a transcript with speaker labels
and timestamps — so an interview becomes text you can edit and export.

https://github.com/user-attachments/assets/6f87acb7-4a2b-4b3f-952f-9960ba3bd41c

## Features

- **Transcribes** speech to text, locally — the audio never leaves the machine
- **Separates speakers** (`SPEAKER_00`, `SPEAKER_01`… — rename them to real names)
- **Keeps timestamps** for every segment
- **Queues files** and runs them one after another
- **Exports** to txt, srt, vtt, json, or a bundle to hand to an LLM for cleanup

## Tech Stack

- App: Electron, TypeScript
- Transcription: whisperx (Whisper + pyannote diarization), running locally
  in its own Python environment — nothing is bundled into the app and no
  audio is uploaded
- Media: ffmpeg

## Getting Started

### Prerequisites

- macOS
- [Node.js](https://nodejs.org)
- ffmpeg and Python 3.10–3.13 — `setup_backend.sh` installs both if missing
  (macOS ships Python 3.9, which whisperx no longer accepts)

### Installation

```bash
git clone https://github.com/Hongda-OSU/hd-audio-transcriber.git
cd hd-audio-transcriber
npm install
bash setup_backend.sh          # several GB, once per machine
bash scripts/make-samples.sh   # test audio; samples/ is not in git
```

Then, for speaker separation only:

1. Accept the model terms at
   [pyannote/speaker-diarization-community-1](https://huggingface.co/pyannote/speaker-diarization-community-1),
   signed in as the account your token belongs to.
2. Create a read token at
   [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
   and paste it into the app under **Settings**. It is saved outside the
   repository and never committed.

## Usage

```bash
npm start        # compile, then launch
npm run dev      # the same, reloading on save
npm run package  # build out/HD Audio Transcriber.app
```

Drop audio on the window, set the options, press **Transcribe**. Drop more
to queue them.

> **Check the names the cleanup step returns.** It is good at punctuation
> and bad at proper nouns: on one interview it renamed someone the recording
> names three times, and cited an original the recording never contained.
> Search the transcript for each quotation it gives you — one you cannot
> find is one it made up.

More in [docs/guide.md](docs/guide.md): how it works, what each tab does,
the export formats, and the rest of what to watch out for.

## License

MIT

# hd-audio-transcriber

macOS Electron app: audio in, transcript out, with speaker labels and
timestamps. Personal tool, MIT. Spec is in Notion; ask before planning.

## Stack

- Runtime: Electron 44, TypeScript 7 — `tsc` only, no bundler, no React
- Transcription: whisperx 3.8.6 from `~/.transcriber-env`, then `~/whisperx-env`
- Package manager: **npm**
- `dependencies` is empty and stays empty

## Commands

| Purpose | Command |
|---|---|
| Install | `npm install` |
| Dev — compile, launch, reload | `npm run dev` |
| Build | `npm run build` |
| Types only | `npm run typecheck` |
| Package to `out/` | `npm run package` |
| Rebuild test audio | `bash scripts/make-samples.sh` |

## Rules

- Pin only whisperx in `setup_backend.sh`. Never torch, pyannote, numpy:
  torch under 2.6 blocks alignment.
- Never bundle Python.
- HuggingFace token: `config.json` on disk, `HF_TOKEN` to whisperx.
  Never argv, never logged, never committed.
- Real interviews never enter the repo, even as examples. Use the
  fictional TTS audio `scripts/make-samples.sh` generates.
- Segments split whisperx's `words[]` at speaker changes, never its
  per-segment `speaker` — a majority vote merging question and answer.
  `unstretch`, then despeckle ≤5-word flicker, then stop: real turns
  have no pause; cleanup fixes the rest.
- Exports render in main, where `words[]` stays: a turn overruns a cue.
- Ask before starting a transcription, a build, or a model download —
  they take minutes and a rebuild closes the window being used.

## Gotchas

- `src/renderer/renderer.ts` is a classic script. An import makes `tsc`
  emit `exports.__esModule` and the page throws `exports is not
  defined`. `moduleDetection: "legacy"` exists for it.
- `unset ELECTRON_RUN_AS_NODE` before launching Electron, or the app
  exits 0 with no output and looks like a signing failure.

## Read these only when relevant

- `docs/guide.md` — what each tab does, the export formats, the known
  rough edges
- Notion「实现笔记与踩过的坑」— whisperx interface, measured timings,
  packaging, release. Ask for the link.

## When unsure

Propose the approach before writing code if a change touches more than
three files, the whisperx command line, or the archive format on disk.
Ask before adding a dependency — `dependencies` is empty today.

Out of scope: signing, notarization, App Store, auto-update, non-macOS.

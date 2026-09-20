# hd-audio-transcriber

macOS Electron app: audio → transcript with speakers and timestamps.

Spec is in a private doc; ask before planning.

## Rules

- Pin only whisperx in `setup_backend.sh`. Never torch, pyannote, numpy: torch under 2.6 blocks alignment.
- Never bundle Python; whisperx runs from `~/.transcriber-env`, then `~/whisperx-env`.
- HuggingFace token: `config.json` on disk, `HF_TOKEN` to whisperx. Never argv, never logged, never committed.
- Segments split whisperx's `words[]` at speaker changes, never its per-segment `speaker` — a majority vote merging question and answer. `unstretch`, then despeckle ≤5-word flicker, then stop: real turns have no pause; cleanup fixes the rest.
- Exports render in main, where `words[]` stays: a turn overruns a cue.
- `src/renderer/renderer.ts` is a classic script; an import breaks it.
- Real interviews never enter the repo, even as examples.

Out of scope: signing, notarization, App Store, auto-update, non-macOS.

```bash
npm run dev    # compile, launch, reload
```

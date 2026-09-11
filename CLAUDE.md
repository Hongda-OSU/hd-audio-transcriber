# hd-audio-transcriber

macOS Electron app: audio → transcript with speakers and timestamps.

Spec is in a private doc; ask before planning.

## Rules

- Pin only whisperx in `setup_backend.sh`. Never torch, pyannote, numpy — torch under 2.6 blocks alignment.
- Never bundle Python. whisperx is spawned from `~/.transcriber-env`, then `~/whisperx-env`; else point at the script.
- The HuggingFace token lives in `config.json`; never commit or log.
- Segments split whisperx's `words[]` at speaker changes, never its per-segment `speaker` — a majority vote merging question and answer. Despeckle first: ≤5 words, no pause either side, same speaker both sides is flicker.
- Exports render in main, where `words[]` stays: a turn overruns a cue.
- `src/renderer/renderer.ts` is a classic script; an import breaks it.
- No bundler, no React; complexity belongs in main.

Out of scope: signing, notarization, App Store, auto-update, non-macOS.

```bash
npm run dev    # compile, launch, reload
```

# hd-audio-transcriber

macOS Electron app: audio → transcript with speakers and timestamps.

The spec is in a private doc; ask for it before planning.

## Rules

- Pin only whisperx in `setup_backend.sh`. Never torch, pyannote or numpy: torch under 2.6 blocks alignment.
- Never bundle Python. whisperx is spawned from `~/.transcriber-env`, then `~/whisperx-env`; with neither, point at `setup_backend.sh`.
- The HuggingFace token lives in `config.json`; never commit or log it.
- Segments split whisperx's `words[]` where the speaker changes, never its per-segment `speaker` — a majority vote merging question with answer.
- Exports render in main, where `words[]` stays: one turn is too long to be one subtitle cue.
- `src/renderer/renderer.ts` is a classic script; an import emits CommonJS and breaks it.
- No bundler, no React; complexity belongs in main.

Out of scope: signing, notarization, App Store, auto-update, non-macOS.

```bash
npm run dev    # compile, launch, reload
```

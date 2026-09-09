# hd-audio-transcriber

Personal macOS Electron app: audio → transcript with speakers and timestamps.

Spec is in Notion, not this repo — read before planning:
https://app.notion.com/p/3cc60d3cf9f381ddbb55dbdcc0b9d87a

## Rules

- Pin only whisperx in `setup_backend.sh`. Never pin torch, pyannote or numpy beneath it — torch under 2.6 blocks alignment.
- Never bundle Python. Spawn whisperx from `~/.transcriber-env`; if missing, point at `setup_backend.sh`, never crash.
- The HuggingFace token lives in `config.json`; never commit or log it.
- Segments come from splitting whisperx's `words[]` where the speaker changes, never from its per-segment `speaker` — a majority vote that merges a question with its answer. Exports derive from them.
- `src/renderer/renderer.ts` is a classic script; an import emits CommonJS and breaks it.
- No bundler, no React — the complexity belongs in the main process.

Out of scope: signing, notarization, App Store, auto-update, non-macOS.

```bash
npm run dev    # compile, launch, reload
```

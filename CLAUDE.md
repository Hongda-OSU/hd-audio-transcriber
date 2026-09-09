# hd-audio-transcriber

Personal macOS Electron app: audio → transcript with speaker labels and timestamps.

Spec is in Notion, not this repo — read before planning:
https://app.notion.com/p/3cc60d3cf9f381ddbb55dbdcc0b9d87a

## Rules

- Pin only whisperx in `setup_backend.sh`. Never pin torch, pyannote or numpy beneath it: torch under 2.6 blocks alignment, and without it a question and its answer return as one speaker.
- Never bundle Python. Spawn whisperx from `~/.transcriber-env`; if missing, point at `setup_backend.sh` — never crash.
- The HuggingFace token lives in `config.json` — never commit or log it.
- whisperx's JSON is the only source of truth; exports derive from its `segments`.
- `src/renderer/renderer.ts` is a classic script. An import emits CommonJS and breaks it.
- No bundler, no React — the complexity belongs in the main process.

Out of scope: signing, notarization, App Store, auto-update, non-macOS, multi-user.

```bash
npm run dev    # compile, launch, reload on save
```

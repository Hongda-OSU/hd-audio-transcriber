# hd-audio-transcriber

Personal macOS Electron app: audio → transcript with speaker labels and timestamps. Not distributed.

Spec is in Notion, not this repo — fetch it before planning:
https://app.notion.com/p/3cc60d3cf9f381ddbb55dbdcc0b9d87a

## Rules

- Never change the pinned versions in `setup_backend.sh` — torch 2.5.1, pyannote.audio 3.1.1, speechbrain 0.5.16, numpy<2 only work together.
- Never bundle Python. Spawn `~/.transcriber-env/bin/whisperx`; if it is missing, point the user at `setup_backend.sh` rather than crashing.
- The HuggingFace token lives in `config.json` — never commit or log it.
- whisperx's JSON is the only source of truth; every export derives from its `segments`.
- `src/renderer/renderer.ts` is a classic script. An import there emits CommonJS and breaks the page at runtime.
- No bundler, no React — the complexity belongs in the main process.

Out of scope: signing, notarization, App Store, auto-update, non-macOS, multi-user.

```bash
npm start        # compile + launch
npm run watch    # tsc --watch, then ⌘R in the app
```

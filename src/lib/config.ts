import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

// userData, not the repo root: a packaged .app has no repo to sit next to, and
// app.setName in main.ts keeps this out of the shared Electron dev folder.
function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

interface Config {
  hfToken?: string;
  settings?: Partial<TranscribeSettings>;
  /** Where exports go. Unset means beside the recording. */
  exportDir?: string;
}

// Alignment defaults on: without it whisperx gives a whole segment one
// speaker, and speaker separation is the reason this app exists.
const DEFAULTS: TranscribeSettings = {
  language: 'zh',
  model: 'large-v3',
  // Detect, not a number. Pinning is the strongest hint diarization gets, but
  // it is absolute: pin 2 on a recording with three people and the third is
  // folded into whichever of the other two he sounds nearest, with no error
  // and a transcript that looks right. A default is not the place to assert
  // something about audio nobody has listened to yet.
  speakers: 0,
  align: true,
};

function read(): Config {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8')) as Config;
  } catch {
    // Missing or unreadable is the normal first-run state, not an error.
    return {};
  }
}

export function getToken(): string {
  return read().hfToken ?? '';
}

/**
 * A masked form for display: enough to tell which token is stored, without
 * handing the renderer the real one just to decide whether a field is empty.
 */
export function tokenPreview(): string {
  const token = getToken();
  if (!token) return '';
  return token.length > 12 ? `${token.slice(0, 6)}…${token.slice(-4)}` : '••••';
}

export function setToken(token: string): void {
  const next: Config = { ...read(), hfToken: token.trim() };
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

export function tokenFile(): string {
  return configPath();
}

/**
 * Where finished transcripts are kept. Alongside the token rather than in the
 * repo: a packaged .app has no repo, and this may hold interview content.
 */
export function transcriptsDir(): string {
  return join(app.getPath('userData'), 'transcripts');
}

/** Empty when the user has not chosen one, which is not the same as a bad
 *  choice: the caller decides what unset falls back to. */
export function getExportDir(): string {
  return read().exportDir ?? '';
}

export function setExportDir(dir: string): void {
  const next: Config = { ...read() };
  if (dir) next.exportDir = dir;
  else delete next.exportDir;
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

export function getSettings(): TranscribeSettings {
  return { ...DEFAULTS, ...read().settings };
}

export function setSettings(settings: TranscribeSettings): void {
  const next: Config = { ...read(), settings };
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

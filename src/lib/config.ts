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
}

// Alignment defaults on: without it whisperx gives a whole segment one
// speaker, and speaker separation is the reason this app exists.
const DEFAULTS: TranscribeSettings = {
  language: 'zh',
  model: 'large-v3',
  speakers: 2,
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

export function getSettings(): TranscribeSettings {
  return { ...DEFAULTS, ...read().settings };
}

export function setSettings(settings: TranscribeSettings): void {
  const next: Config = { ...read(), settings };
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

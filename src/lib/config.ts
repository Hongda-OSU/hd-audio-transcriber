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
}

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

export function setToken(token: string): void {
  const next: Config = { ...read(), hfToken: token.trim() };
  writeFileSync(configPath(), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

export function tokenFile(): string {
  return configPath();
}

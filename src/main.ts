import { copyFileSync, watch } from 'node:fs';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { probeAudio } from './lib/probe';
import { cancel, transcribe, WhisperxError } from './lib/whisperx';
import { getToken, setToken, tokenFile } from './lib/config';

// Set before anything reads app.getPath('userData'), or the config lands in the
// folder every unpackaged Electron app shares.
app.setName('hd-audio-transcriber');

// M3 turns these into UI controls. Until then they are the spec's defaults.
const LANGUAGE = 'zh';
const MODEL = 'large-v3';
const SPEAKERS = 2;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 560,
    minHeight: 420,
    backgroundColor: '#0E0F10', // paints before the page does, so no white flash
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // A run outlives its window otherwise, and whisperx on a long file will sit
  // there burning CPU long after the app looks closed.
  win.on('close', cancel);

  void win.loadFile(join(__dirname, 'renderer', 'index.html'));
  watchForReload(win);
  return win;
}

/**
 * Reloads the window when `tsc --watch` rewrites dist/. Renderer changes just
 * reload the page; anything in the main process needs the whole app back, so
 * it relaunches. Development only — a packaged app never watches itself.
 */
function watchForReload(win: BrowserWindow): void {
  if (app.isPackaged) return;

  const srcRenderer = join(__dirname, '..', 'src', 'renderer');

  let timer: NodeJS.Timeout | undefined;
  let mainChanged = false;

  const settle = () => {
    // tsc rewrites several files in a burst; act once it settles, or the app
    // relaunches mid-compile and loads a half-written dist.
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (mainChanged) {
        cancel();
        app.relaunch();
        app.exit(0);
      } else if (!win.isDestroyed()) {
        win.webContents.reloadIgnoringCache();
      }
      mainChanged = false;
    }, 250);
  };

  // Compiled output: tsc --watch writes here.
  watch(__dirname, { recursive: true }, (_event, filename) => {
    if (!filename || !/\.(js|css|html)$/.test(filename)) return;
    if (!filename.startsWith('renderer')) mainChanged = true;
    settle();
  });

  // tsc only knows about .ts, so the markup and styles are copied here too —
  // otherwise editing them would change nothing until the next npm run build.
  watch(srcRenderer, (_event, filename) => {
    if (!filename || !/\.(css|html)$/.test(filename)) return;
    try {
      copyFileSync(join(srcRenderer, filename), join(__dirname, 'renderer', filename));
    } catch {
      // The editor may have moved the file mid-save; the next event catches it.
      return;
    }
    settle();
  });
}

ipcMain.handle('dialog:openAudio', async (): Promise<string | null> => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '选择音频文件',
    properties: ['openFile'],
    // The audio filter is a convenience, not a gate — "所有文件" stays available
    // because ffprobe, not this list, decides what we can actually read.
    filters: [
      {
        name: '音频',
        extensions: ['m4a', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'mp4', 'mov', 'aiff', 'wma'],
      },
      { name: '所有文件', extensions: ['*'] },
    ],
  });

  return canceled || filePaths.length === 0 ? null : (filePaths[0] ?? null);
});

ipcMain.handle('audio:probe', async (_event, filePath: string): Promise<AudioInfo | IpcFailure> => {
  try {
    return await probeAudio(filePath);
  } catch (err) {
    // Failures travel back as data. A rejected handler would land in the
    // renderer as an unhandled rejection instead of a message worth reading.
    return { error: (err as Error).message };
  }
});

ipcMain.handle('config:getToken', () => getToken());
ipcMain.handle('config:setToken', (_event, token: string) => setToken(token));
ipcMain.handle('config:path', () => tokenFile());

ipcMain.handle(
  'audio:transcribe',
  async (event, filePath: string): Promise<TranscribeResult | IpcFailure> => {
    const hfToken = getToken();
    if (!hfToken) {
      return {
        error: '说话人分离需要 HuggingFace token。请在「设置」里填入。',
      };
    }

    try {
      return await transcribe(
        {
          file: filePath,
          language: LANGUAGE,
          model: MODEL,
          minSpeakers: SPEAKERS,
          maxSpeakers: SPEAKERS,
          hfToken,
        },
        (line) => {
          // The window can be gone by the time a late line arrives.
          if (!event.sender.isDestroyed()) event.sender.send('transcribe:progress', line);
        },
      );
    } catch (err) {
      if (err instanceof WhisperxError) return { error: err.message };
      return { error: `转录失败：${(err as Error).message}` };
    }
  },
);

void app.whenReady().then(() => {
  // A packaged build takes its icon from build/icon.icns. In development the
  // Dock would otherwise show Electron's own, so point it at the same art.
  if (!app.isPackaged) {
    app.dock?.setIcon(join(__dirname, '..', 'build', 'icon.png'));
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', cancel);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

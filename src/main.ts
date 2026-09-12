import { copyFileSync, watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron';

import { forgetRun, listRuns, readArchive, recordRun } from './lib/archive';
import { EXTENSIONS, render } from './lib/exporters';
import { probeAudio } from './lib/probe';
import { cancel, isRunning, transcribe, WhisperxCancelled, WhisperxError } from './lib/whisperx';
import {
  getExportDir,
  getSettings,
  getToken,
  setExportDir,
  setSettings,
  setToken,
  tokenFile,
  tokenPreview,
  transcriptsDir,
} from './lib/config';

// The identifier, not the display name — it decides where userData lives, and
// the saved token is already under this one. Renaming it would strand that
// file. Set before anything reads app.getPath('userData'), or the config lands
// in the folder every unpackaged Electron app shares.
app.setName('hd-audio-transcriber');

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

  const apply = () => {
    // Never interrupt a run for a code edit. Reloading destroys the renderer
    // and with it the promise waiting on the result, while a relaunch calls
    // cancel() and kills whisperx outright — either one throws away work that
    // can be hours old, and neither leaves a trace of why.
    if (isRunning()) {
      console.log('[dev] reload deferred — a transcription is running');
      timer = setTimeout(apply, 2000);
      return;
    }

    if (mainChanged) {
      cancel();
      app.relaunch();
      app.exit(0);
    } else if (!win.isDestroyed()) {
      win.webContents.reloadIgnoringCache();
    }
    mainChanged = false;
  };

  const settle = () => {
    // tsc rewrites several files in a burst; act once it settles, or the app
    // relaunches mid-compile and loads a half-written dist.
    clearTimeout(timer);
    timer = setTimeout(apply, 250);
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
    title: 'Choose audio',
    properties: ['openFile'],
    // The audio filter is a convenience, not a gate — "All files" stays available
    // because ffprobe, not this list, decides what we can actually read.
    filters: [
      {
        name: 'Audio',
        extensions: ['m4a', 'mp3', 'wav', 'flac', 'aac', 'ogg', 'opus', 'mp4', 'mov', 'aiff', 'wma'],
      },
      { name: 'All files', extensions: ['*'] },
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

ipcMain.handle('audio:cancel', () => cancel());

ipcMain.handle('config:tokenPreview', () => tokenPreview());
ipcMain.handle('config:setToken', (_event, token: string) => setToken(token));
ipcMain.handle('config:path', () => tokenFile());
ipcMain.handle('config:transcriptsPath', () => transcriptsDir());

ipcMain.handle('config:getExportDir', () => getExportDir());
ipcMain.handle('config:clearExportDir', () => setExportDir(''));

ipcMain.handle('config:chooseExportDir', async (event): Promise<string> => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const options: Electron.OpenDialogOptions = {
    title: 'Where exports go',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Use this folder',
  };
  const { canceled, filePaths } = await (win
    ? dialog.showOpenDialog(win, options)
    : dialog.showOpenDialog(options));

  const chosen = canceled ? '' : (filePaths[0] ?? '');
  if (chosen) setExportDir(chosen);
  return chosen;
});
ipcMain.handle('config:getSettings', () => getSettings());
ipcMain.handle('config:setSettings', (_event, settings: TranscribeSettings) => setSettings(settings));

/**
 * The last finished run, kept here rather than in the renderer because exports
 * are rendered here: word timings are what a subtitle is cut on, and sending
 * every word across the bridge only to have it sent back would be a round trip
 * for data the window never shows.
 */
let lastRun: { result: TranscribeResult; audioPath?: string } | null = null;

/**
 * Paths this process has told the window about. Revealing one only opens
 * Finder, but the renderer should not be able to name a path the app never
 * wrote — it decides nothing else about the filesystem.
 */
const revealable = new Set<string>();

ipcMain.handle('shell:reveal', (_event, target: string): void => {
  if (revealable.has(target)) shell.showItemInFolder(target);
});

/**
 * Keeps the machine awake while a run is in flight. An hour of audio is about
 * two hours of work; a Mac that idles to sleep in the middle of that takes
 * whisperx with it, and the README's advice to run `caffeinate` yourself was
 * the app admitting it did not handle its own longest operation.
 *
 * 'prevent-app-suspension' rather than 'prevent-display-sleep' — the work does
 * not need the screen on. Closing the lid still sleeps, as it does for
 * caffeinate; nothing in userspace overrides that.
 */
let awake: number | null = null;

function stayAwake(): void {
  if (awake === null) awake = powerSaveBlocker.start('prevent-app-suspension');
}

/** Always from a finally. A blocker left on holds the machine awake until the
 *  app quits, which is a worse failure than never having started one. */
function letSleep(): void {
  if (awake !== null && powerSaveBlocker.isStarted(awake)) powerSaveBlocker.stop(awake);
  awake = null;
}

/** Word timings are for the exporters; the window shows whole segments. */
function withoutWords(result: TranscribeResult): TranscribeResult {
  return {
    ...result,
    segments: result.segments.map(({ start, end, text, speaker }) => ({
      start,
      end,
      text,
      ...(speaker ? { speaker } : {}),
    })),
  };
}

ipcMain.handle(
  'audio:transcribe',
  async (
    event,
    filePath: string,
    settings: TranscribeSettings,
  ): Promise<TranscribeResult | Canceled | IpcFailure> => {
    const hfToken = getToken();
    if (!hfToken) {
      return {
        error: 'Speaker separation needs a HuggingFace token. Add one under Settings.',
      };
    }

    try {
      // Remember what was used, so the next run opens on the same choices.
      setSettings(settings);
      stayAwake();

      const result = await transcribe(
        { file: filePath, hfToken, archiveDir: transcriptsDir(), ...settings },
        (progress) => {
          // The window can be gone by the time a late update arrives.
          if (!event.sender.isDestroyed()) event.sender.send('transcribe:progress', progress);
        },
      );

      lastRun = { result, audioPath: filePath };
      if (result.savedTo) {
        revealable.add(result.savedTo);
        // The JSON itself says none of this, and without it a folder of runs
        // is a list of timestamps.
        await recordRun(transcriptsDir(), basename(result.savedTo), {
          audio: filePath,
          settings,
          ...(result.elapsedSec ? { elapsedSec: result.elapsedSec } : {}),
          segments: result.segments.length,
          speakers: new Set(result.segments.map((s) => s.speaker).filter(Boolean)).size,
        });
      }
      return withoutWords(result);
    } catch (err) {
      // Stopping is something the user did, not something that went wrong.
      if (err instanceof WhisperxCancelled) return { canceled: true };
      if (err instanceof WhisperxError) return { error: err.message };
      return { error: `Transcription failed: ${(err as Error).message}` };
    } finally {
      letSleep();
    }
  },
);

ipcMain.handle('transcripts:list', (): Promise<ArchivedRun[]> => listRuns(transcriptsDir()));

ipcMain.handle(
  'transcripts:open',
  async (_event, target: string): Promise<TranscribeResult | IpcFailure> => {
    // The renderer names the file, so main decides whether it may be read.
    // Only what the app itself wrote, and only from the folder it wrote it to.
    const runs = await listRuns(transcriptsDir());
    const run = runs.find((r) => r.path === target);
    if (!run) return { error: 'That transcript is no longer in the folder.' };

    let result: TranscribeResult;
    try {
      result = await readArchive(run.path);
    } catch (err) {
      return { error: `Could not read ${run.file}: ${(err as Error).message}` };
    }

    // Opening it is what export acts on, so the rest of the app needs no idea
    // where a transcript came from.
    lastRun = { result, ...(run.audio ? { audioPath: run.audio } : {}) };
    revealable.add(run.path);

    // A run from before the index existed learns this much by being opened.
    await recordRun(transcriptsDir(), run.file, {
      segments: result.segments.length,
      speakers: new Set(result.segments.map((s) => s.speaker).filter(Boolean)).size,
      ...(run.names ? { names: run.names } : {}),
    });

    return withoutWords(result);
  },
);

ipcMain.handle(
  'transcripts:delete',
  async (_event, target: string): Promise<IpcFailure | null> => {
    // The same guard opening uses: only a file this app wrote, in the folder
    // it wrote it to, and only one the folder still holds.
    const runs = await listRuns(transcriptsDir());
    const run = runs.find((r) => r.path === target);
    if (!run) return { error: 'That transcript is no longer in the folder.' };

    // The Trash, not unlink. An hour of audio is an hour of this machine's
    // work and sometimes the only written copy of an interview; the Finder
    // already knows how to undo this, which is worth more than a confirmation
    // dialog that gets clicked through.
    try {
      await shell.trashItem(run.path);
    } catch (err) {
      return { error: `Could not delete ${run.file}: ${(err as Error).message}` };
    }

    await forgetRun(transcriptsDir(), run.file);
    revealable.delete(run.path);

    // Export renders from here, not from the window, so a deleted run left in
    // lastRun would still write itself out to a file after its own was binned.
    if (lastRun?.result.savedTo === run.path) lastRun = null;
    return null;
  },
);

const FILTERS: Record<ExportFormat, string> = {
  txt: 'Text',
  srt: 'SubRip subtitles',
  vtt: 'WebVTT subtitles',
  json: 'JSON',
};

ipcMain.handle(
  'transcript:export',
  async (
    event,
    format: ExportFormat,
    names: SpeakerNames,
  ): Promise<ExportSaved | Canceled | IpcFailure> => {
    if (!lastRun) return { error: 'There is no transcript to export yet.' };

    const extension = EXTENSIONS[format];
    if (!extension) return { error: `Unknown export format: ${format}` };

    const { result, audioPath } = lastRun;
    // Next to the recording, which is where the person who has both of them is
    // already looking. An archived run may not remember where its audio was,
    // and the archive folder itself is hidden, so that falls back to Documents.
    const stem = audioPath
      ? basename(audioPath, extname(audioPath))
      : basename(result.savedTo ?? 'transcript', '.json');
    const folder = getExportDir() || (audioPath ? dirname(audioPath) : app.getPath('documents'));
    const suggested = join(folder, `${stem}.${extension}`);
    const win = BrowserWindow.fromWebContents(event.sender);

    const { canceled, filePath } = await (win
      ? dialog.showSaveDialog(win, {
          defaultPath: suggested,
          filters: [{ name: FILTERS[format], extensions: [extension] }],
        })
      : dialog.showSaveDialog({ defaultPath: suggested }));

    if (canceled || !filePath) return { canceled: true };

    try {
      await writeFile(
        filePath,
        render(format, { segments: result.segments, language: result.language, names }),
        'utf8',
      );
    } catch (err) {
      return { error: `Could not write ${filePath}: ${(err as Error).message}` };
    }

    revealable.add(filePath);
    return { path: filePath };
  },
);

void app.whenReady().then(() => {
  // Shown in Settings, so they have to be openable from there.
  revealable.add(transcriptsDir());
  revealable.add(tokenFile());
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

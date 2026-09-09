import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';

import { probeAudio } from './lib/probe';

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

  void win.loadFile(join(__dirname, 'renderer', 'index.html'));
  return win;
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

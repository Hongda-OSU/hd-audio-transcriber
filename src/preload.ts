import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api: TranscriberApi = {
  // Electron 32 removed File.path, so a dropped File no longer knows where it
  // came from. This is the supported way to get the path back.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  chooseFile: () => ipcRenderer.invoke('dialog:openAudio'),

  probe: (filePath) => ipcRenderer.invoke('audio:probe', filePath),
};

contextBridge.exposeInMainWorld('api', api);

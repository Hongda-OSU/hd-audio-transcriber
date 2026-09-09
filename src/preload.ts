import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api: TranscriberApi = {
  // Electron 32 removed File.path, so a dropped File no longer knows where it
  // came from. This is the supported way to get the path back.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  chooseFile: () => ipcRenderer.invoke('dialog:openAudio'),

  probe: (filePath) => ipcRenderer.invoke('audio:probe', filePath),

  transcribe: (filePath) => ipcRenderer.invoke('audio:transcribe', filePath),

  // The event object stays on this side of the bridge; the renderer only ever
  // sees the line itself.
  onProgress: (listener) => {
    ipcRenderer.on('transcribe:progress', (_event, line: string) => listener(line));
  },

  getToken: () => ipcRenderer.invoke('config:getToken'),
  setToken: (token) => ipcRenderer.invoke('config:setToken', token),
};

contextBridge.exposeInMainWorld('api', api);

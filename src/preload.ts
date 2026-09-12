import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api: TranscriberApi = {
  // Electron 32 removed File.path, so a dropped File no longer knows where it
  // came from. This is the supported way to get the path back.
  getPathForFile: (file) => webUtils.getPathForFile(file),

  chooseFile: () => ipcRenderer.invoke('dialog:openAudio'),

  probe: (filePath) => ipcRenderer.invoke('audio:probe', filePath),

  transcribe: (filePath, settings) => ipcRenderer.invoke('audio:transcribe', filePath, settings),

  cancelTranscription: () => ipcRenderer.invoke('audio:cancel'),

  listTranscripts: () => ipcRenderer.invoke('transcripts:list'),
  openTranscript: (target) => ipcRenderer.invoke('transcripts:open', target),
  deleteTranscript: (target) => ipcRenderer.invoke('transcripts:delete', target),
  saveSpeakerNames: (names) => ipcRenderer.invoke('transcripts:rename', names),

  exportTranscript: (format, names) => ipcRenderer.invoke('transcript:export', format, names),

  revealPath: (target) => ipcRenderer.invoke('shell:reveal', target),

  // The event object stays on this side of the bridge; the renderer only ever
  // sees the line itself.
  onProgress: (listener) => {
    ipcRenderer.on('transcribe:progress', (_e, p: TranscribeProgress) => listener(p));
  },

  getTokenPreview: () => ipcRenderer.invoke('config:tokenPreview'),
  setToken: (token) => ipcRenderer.invoke('config:setToken', token),
  getConfigPath: () => ipcRenderer.invoke('config:path'),
  getTranscriptsPath: () => ipcRenderer.invoke('config:transcriptsPath'),

  getExportDir: () => ipcRenderer.invoke('config:getExportDir'),
  chooseExportDir: () => ipcRenderer.invoke('config:chooseExportDir'),
  clearExportDir: () => ipcRenderer.invoke('config:clearExportDir'),

  getSettings: () => ipcRenderer.invoke('config:getSettings'),
  setSettings: (settings) => ipcRenderer.invoke('config:setSettings', settings),
};

contextBridge.exposeInMainWorld('api', api);

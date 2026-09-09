// Ambient shapes shared by the main process, the preload bridge and the
// renderer. Declared globally rather than exported so the renderer — a plain
// script, not a module — can use them without an import.

/** What we know about an imported audio file before any transcription. */
interface AudioInfo {
  path: string;
  name: string;
  /** null when the container does not report one. */
  durationSec: number | null;
  sizeBytes: number;
  formatName: string;
}

/** IPC handlers return this instead of rejecting, so the UI can show the text. */
interface IpcFailure {
  error: string;
}

interface TranscriberApi {
  /** Electron 32 removed File.path; this is how a dropped file gets one back. */
  getPathForFile(file: File): string;
  chooseFile(): Promise<string | null>;
  probe(filePath: string): Promise<AudioInfo | IpcFailure>;
}

interface Window {
  api: TranscriberApi;
}

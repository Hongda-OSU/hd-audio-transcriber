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

/**
 * One line of transcript, straight out of whisperx's JSON. This is the app's
 * source of truth — every export format is derived from a list of these.
 */
interface Segment {
  start: number;
  end: number;
  text: string;
  /** Only present when whisperx ran with --diarize. */
  speaker?: string;
}

interface TranscribeResult {
  segments: Segment[];
  language: string;
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

  transcribe(filePath: string): Promise<TranscribeResult | IpcFailure>;
  /** Raw whisperx stderr lines, forwarded as they arrive. */
  onProgress(listener: (line: string) => void): void;

  getToken(): Promise<string>;
  setToken(token: string): Promise<void>;
  /** Where the token is stored, shown in settings. */
  getConfigPath(): Promise<string>;
}

interface Window {
  api: TranscriberApi;
}

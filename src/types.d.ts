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

/** What the user picked in the options row; persisted between runs. */
interface TranscribeSettings {
  language: string;
  model: string;
  /** 0 lets whisperx decide; anything else pins --min/--max_speakers. */
  speakers: number;
  /** Word alignment. Off is faster but collapses each segment to one
   *  speaker, so the labels stop being trustworthy. */
  align: boolean;
}

/** whisperx reports a percentage while transcribing and nothing after. */
interface TranscribeProgress {
  phase: string;
  /** 0–100 within the phase, or null when the phase reports nothing. */
  percent: number | null;
  /** The raw log line, for the detail under the bar. */
  line: string;
}

interface TranscribeResult {
  segments: Segment[];
  language: string;
  /** Where whisperx's own JSON was kept, so a run survives the window. */
  savedTo?: string;
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

  transcribe(filePath: string, settings: TranscribeSettings): Promise<TranscribeResult | IpcFailure>;
  onProgress(listener: (progress: TranscribeProgress) => void): void;

  getSettings(): Promise<TranscribeSettings>;
  setSettings(settings: TranscribeSettings): Promise<void>;

  /** Masked, e.g. hf_abc…wxyz, or '' when unset. The real token stays in main. */
  getTokenPreview(): Promise<string>;
  setToken(token: string): Promise<void>;
  /** Where the token is stored, shown in settings. */
  getConfigPath(): Promise<string>;
}

interface Window {
  api: TranscriberApi;
}

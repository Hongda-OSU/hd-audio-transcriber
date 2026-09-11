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

/** One word with the timing alignment gave it. */
interface Word {
  word: string;
  start: number;
  end: number;
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
  /**
   * Present when alignment ran. A segment is as long as a speaker's turn,
   * which is far too long to read as a subtitle, so srt and vtt cut it here.
   * Stays in the main process — the renderer never shows a word on its own.
   */
  words?: Word[];
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
  /** Wall time the run took. An hour of audio is about two hours of work, and
   *  the progress bar is gone by the time anyone asks how long it was. */
  elapsedSec?: number;
}

/** IPC handlers return this instead of rejecting, so the UI can show the text. */
interface IpcFailure {
  error: string;
}

type ExportFormat = 'txt' | 'srt' | 'vtt' | 'json';

/** SPEAKER_00 → "Interviewer". Labels left out keep their own name. */
type SpeakerNames = Record<string, string>;

interface ExportSaved {
  path: string;
}

/** The user called it off — closing the save dialog, stopping a run. Not a
 *  failure, and it gets no error message. */
interface Canceled {
  canceled: true;
}

interface TranscriberApi {
  /** Electron 32 removed File.path; this is how a dropped file gets one back. */
  getPathForFile(file: File): string;
  chooseFile(): Promise<string | null>;
  probe(filePath: string): Promise<AudioInfo | IpcFailure>;

  transcribe(
    filePath: string,
    settings: TranscribeSettings,
  ): Promise<TranscribeResult | Canceled | IpcFailure>;
  /** Stops the run in flight. Does nothing when there is none. */
  cancelTranscription(): Promise<void>;
  onProgress(listener: (progress: TranscribeProgress) => void): void;

  /** Renders the last run in main, where the word timings stayed, and asks
   *  for a save location. */
  exportTranscript(
    format: ExportFormat,
    names: SpeakerNames,
  ): Promise<ExportSaved | Canceled | IpcFailure>;

  /** Opens Finder on a file the app wrote. Main refuses any other path. */
  revealPath(target: string): Promise<void>;

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

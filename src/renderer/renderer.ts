const dropzone = document.getElementById('dropzone') as HTMLButtonElement;
const statusLine = document.getElementById('status') as HTMLParagraphElement;
const logLine = document.getElementById('log') as HTMLParagraphElement;

const fileSection = document.getElementById('file') as HTMLElement;
const fileName = document.getElementById('fileName') as HTMLElement;
const fileMeta = document.getElementById('fileMeta') as HTMLElement;
const filePathEl = document.getElementById('filePath') as HTMLElement;
const startButton = document.getElementById('start') as HTMLButtonElement;

const tabTranscribe = document.getElementById('tabTranscribe') as HTMLButtonElement;
const tabSettings = document.getElementById('tabSettings') as HTMLButtonElement;
const panelTranscribe = document.getElementById('panelTranscribe') as HTMLElement;
const panelSettings = document.getElementById('panelSettings') as HTMLElement;

const tokenInput = document.getElementById('token') as HTMLInputElement;
const saveTokenButton = document.getElementById('saveToken') as HTMLButtonElement;
const tokenState = document.getElementById('tokenState') as HTMLElement;
const tokenPath = document.getElementById('tokenPath') as HTMLElement;

const resultSection = document.getElementById('result') as HTMLElement;
const resultMeta = document.getElementById('resultMeta') as HTMLElement;
const segmentList = document.getElementById('segments') as HTMLOListElement;

/** The file currently loaded, and the input to a transcription run. */
let current: AudioInfo | null = null;
let busy = false;

/* --- formatting -------------------------------------------------------- */

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'unknown length';

  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** SPEAKER_00 → Speaker 1. M4 replaces these with real names. */
function speakerLabel(speaker: string | undefined): string {
  if (!speaker) return 'Unknown';
  const match = /(\d+)$/.exec(speaker);
  return match ? `Speaker ${Number(match[1]) + 1}` : speaker;
}

/* --- rendering --------------------------------------------------------- */

function showStatus(message: string, isError = false): void {
  statusLine.textContent = message;
  statusLine.classList.toggle('is-error', isError);
  statusLine.hidden = false;
}

function clearStatus(): void {
  statusLine.hidden = true;
}

function showFile(info: AudioInfo): void {
  current = info;
  fileName.textContent = info.name;
  fileMeta.textContent = [formatDuration(info.durationSec), formatSize(info.sizeBytes)].join(' · ');
  filePathEl.textContent = info.path;
  fileSection.hidden = false;
}

function clearFile(): void {
  current = null;
  fileSection.hidden = true;
}

function clearResult(): void {
  resultSection.hidden = true;
  segmentList.replaceChildren();
}

function renderResult(result: TranscribeResult): void {
  segmentList.replaceChildren();

  for (const segment of result.segments) {
    const item = document.createElement('li');
    item.className = 'segment';

    const time = document.createElement('span');
    time.className = 'segment__time';
    time.textContent = formatTimestamp(segment.start);

    const who = document.createElement('span');
    who.className = 'segment__speaker';
    who.textContent = speakerLabel(segment.speaker);
    // M4 renames speakers in bulk; the attribute is what it will select on.
    who.dataset.speaker = segment.speaker ?? '';

    const text = document.createElement('span');
    text.className = 'segment__text';
    text.textContent = segment.text;

    item.append(time, who, text);
    segmentList.append(item);
  }

  const speakers = new Set(result.segments.map((s) => s.speaker).filter(Boolean));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  resultMeta.textContent = [
    plural(result.segments.length, 'segment'),
    plural(speakers.size, 'speaker'),
    ...(result.language ? [result.language] : []),
  ].join(' · ');
  resultSection.hidden = false;
}

function setBusy(value: boolean): void {
  busy = value;
  startButton.disabled = value;
  startButton.textContent = value ? 'Transcribing…' : 'Transcribe';
  dropzone.classList.toggle('is-disabled', value);
}

/* --- actions ----------------------------------------------------------- */

async function loadFile(path: string | null): Promise<void> {
  if (!path || busy) return;

  clearFile();
  clearResult();
  logLine.hidden = true;
  showStatus('Reading…');

  const result = await window.api.probe(path);

  // Narrowing on the failure shape is the whole reason IPC returns data
  // instead of throwing.
  if ('error' in result) {
    showStatus(result.error, true);
    return;
  }

  clearStatus();
  showFile(result);
}

async function runTranscription(): Promise<void> {
  if (!current || busy) return;

  clearResult();
  setBusy(true);
  showStatus('Transcribing… the first run downloads models and can take a long time.');
  logLine.hidden = false;
  logLine.textContent = '';

  const result = await window.api.transcribe(current.path);
  setBusy(false);

  if ('error' in result) {
    showStatus(result.error, true);
    // A missing token is the one failure the user can fix right now, so put
    // them in front of the field instead of making them find it.
    if (result.error.includes('token')) {
      void refreshTokenState().then(() => showTab('settings'));
    }
    return;
  }

  clearStatus();
  logLine.hidden = true;
  renderResult(result);
}

async function refreshTokenState(): Promise<void> {
  const preview = await window.api.getTokenPreview();
  tokenState.textContent = preview ? `Saved · ${preview}` : 'Not set';
  tokenPath.textContent = await window.api.getConfigPath();
}

/** Saving cleared the field and changed one dim word, which read as nothing
 *  happening. Flash the line so the click visibly lands. */
function flashTokenState(): void {
  tokenState.classList.add('is-fresh');
  setTimeout(() => tokenState.classList.remove('is-fresh'), 1200);
}

/* --- tabs -------------------------------------------------------------- */

function showTab(which: 'transcribe' | 'settings'): void {
  const settings = which === 'settings';

  panelTranscribe.hidden = settings;
  panelSettings.hidden = !settings;

  tabTranscribe.classList.toggle('is-active', !settings);
  tabSettings.classList.toggle('is-active', settings);
  tabTranscribe.setAttribute('aria-selected', String(!settings));
  tabSettings.setAttribute('aria-selected', String(settings));
}

/* --- drag and drop ----------------------------------------------------- */

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

function setDragging(dragging: boolean): void {
  dropzone.classList.toggle('is-dragging', dragging);
}

// Without preventDefault on both events, Electron navigates the window to the
// dropped file and the app turns into a file viewer. Bound to the window so a
// miss anywhere in the frame is still caught.
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (isFileDrag(event) && !busy) setDragging(true);
});

window.addEventListener('dragleave', (event) => {
  // relatedTarget is null only when the pointer leaves the window itself,
  // which keeps the highlight steady while crossing child elements.
  if (!event.relatedTarget) setDragging(false);
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  setDragging(false);

  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  // Single file by design; extra ones in the same drop are ignored.
  void loadFile(window.api.getPathForFile(file));
});

/* --- wiring ------------------------------------------------------------ */

dropzone.addEventListener('click', () => {
  void window.api.chooseFile().then(loadFile);
});

startButton.addEventListener('click', () => {
  void runTranscription();
});

saveTokenButton.addEventListener('click', () => {
  const value = tokenInput.value.trim();
  if (!value) return;
  void window.api.setToken(value).then(async () => {
    tokenInput.value = '';
    await refreshTokenState();
    flashTokenState();
    clearStatus();
  });
});

// whisperx is chatty and its last line is the most informative, so the log
// shows one line rather than growing without bound.
window.api.onProgress((line) => {
  logLine.textContent = line;
});

tabTranscribe.addEventListener('click', () => showTab('transcribe'));
tabSettings.addEventListener('click', () => showTab('settings'));

void refreshTokenState();

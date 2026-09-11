const dropzone = document.getElementById('dropzone') as HTMLButtonElement;
const statusLine = document.getElementById('status') as HTMLParagraphElement;
const logLine = document.getElementById('log') as HTMLParagraphElement;

const dropEmpty = document.getElementById('dropEmpty') as HTMLElement;
const dropFile = document.getElementById('dropFile') as HTMLElement;
const fileName = document.getElementById('fileName') as HTMLElement;
const fileMeta = document.getElementById('fileMeta') as HTMLElement;
const filePathEl = document.getElementById('filePath') as HTMLElement;
const startButton = document.getElementById('start') as HTMLButtonElement;

type TabName = 'transcribe' | 'transcript' | 'settings';

const TABS: Record<TabName, { tab: HTMLButtonElement; panel: HTMLElement }> = {
  transcribe: {
    tab: document.getElementById('tabTranscribe') as HTMLButtonElement,
    panel: document.getElementById('panelTranscribe') as HTMLElement,
  },
  transcript: {
    tab: document.getElementById('tabTranscript') as HTMLButtonElement,
    panel: document.getElementById('panelTranscript') as HTMLElement,
  },
  settings: {
    tab: document.getElementById('tabSettings') as HTMLButtonElement,
    panel: document.getElementById('panelSettings') as HTMLElement,
  },
};

const tokenInput = document.getElementById('token') as HTMLInputElement;
const saveTokenButton = document.getElementById('saveToken') as HTMLButtonElement;
const tokenState = document.getElementById('tokenState') as HTMLElement;
const tokenPath = document.getElementById('tokenPath') as HTMLElement;

const optLanguage = document.getElementById('optLanguage') as HTMLSelectElement;
const optModel = document.getElementById('optModel') as HTMLSelectElement;
const optSpeakers = document.getElementById('optSpeakers') as HTMLSelectElement;
const optAlign = document.getElementById('optAlign') as HTMLInputElement;

const progressSection = document.getElementById('progress') as HTMLElement;
const progressPhase = document.getElementById('progressPhase') as HTMLElement;
const progressPercent = document.getElementById('progressPercent') as HTMLElement;
const progressBar = document.getElementById('progressBar') as HTMLElement;

const resultMeta = document.getElementById('resultMeta') as HTMLElement;
const segmentList = document.getElementById('segments') as HTMLOListElement;
const savedTo = document.getElementById('savedTo') as HTMLElement;

const speakerFields = document.getElementById('speakerFields') as HTMLElement;
const exportFormat = document.getElementById('exportFormat') as HTMLSelectElement;
const exportButton = document.getElementById('export') as HTMLButtonElement;
const exportState = document.getElementById('exportState') as HTMLElement;

/** The file currently loaded, and the input to a transcription run. */
let current: AudioInfo | null = null;
let busy = false;

/**
 * What the user has renamed each diarization label to. Lives for as long as
 * the window does: there is no way yet to reopen a past run, so a name written
 * to disk would have nothing to read it back.
 */
let speakerNames: SpeakerNames = {};

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

/** The dropzone is the file card: once something is loaded, the prompt would
 *  just be a second copy of an invitation already accepted. */
function showFile(info: AudioInfo): void {
  current = info;
  fileName.textContent = info.name;
  fileMeta.textContent = [formatDuration(info.durationSec), formatSize(info.sizeBytes)].join(' · ');
  filePathEl.textContent = info.path;

  dropEmpty.hidden = true;
  dropFile.hidden = false;
  dropzone.classList.add('is-loaded');
  startButton.disabled = false;
}

function clearFile(): void {
  current = null;
  dropEmpty.hidden = false;
  dropFile.hidden = true;
  dropzone.classList.remove('is-loaded');
  // Disabled rather than hidden: it shares a row with the alignment toggle, and
  // removing it would shuffle that row every time a file is loaded or cleared.
  startButton.disabled = true;
}

function clearResult(): void {
  segmentList.replaceChildren();
  speakerFields.replaceChildren();
  speakerFields.hidden = true;
  speakerNames = {};
  exportState.hidden = true;
  TABS.transcript.tab.disabled = true;
  // A tab with nothing behind it should not be where the user is standing.
  if (!TABS.transcript.panel.hidden) showTab('transcribe');
}

/** Renaming is worth doing once for a whole interview and never worth doing
 *  per line, so one field drives every segment that label appears on. */
function applySpeakerName(speaker: string, value: string): void {
  const name = value.trim();
  if (name) speakerNames[speaker] = name;
  else delete speakerNames[speaker];

  const selector = `.segment__speaker[data-speaker="${CSS.escape(speaker)}"]`;
  for (const element of segmentList.querySelectorAll<HTMLElement>(selector)) {
    element.textContent = name || speakerLabel(speaker);
  }
}

function renderSpeakerFields(segments: Segment[]): void {
  speakerFields.replaceChildren();

  const speakers: string[] = [];
  for (const segment of segments) {
    if (segment.speaker && !speakers.includes(segment.speaker)) speakers.push(segment.speaker);
  }

  for (const speaker of speakers) {
    const field = document.createElement('label');
    field.className = 'speaker';

    const input = document.createElement('input');
    input.className = 'speaker__input';
    input.type = 'text';
    // The placeholder is the only thing saying which speaker this is, so it
    // has to be the label the transcript is already showing.
    input.placeholder = speakerLabel(speaker);
    // The name gets a column of its own in the transcript; past this it stops
    // being a name and starts crowding out the words.
    input.maxLength = 20;
    input.spellcheck = false;
    input.value = speakerNames[speaker] ?? '';
    input.addEventListener('input', () => applySpeakerName(speaker, input.value));

    field.append(input);
    speakerFields.append(field);
  }

  // Diarization can come back with nothing to name.
  speakerFields.hidden = speakers.length === 0;
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
    who.textContent = segment.speaker
      ? speakerNames[segment.speaker] || speakerLabel(segment.speaker)
      : speakerLabel(segment.speaker);
    // What a rename selects on: the label survives the name being changed.
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

  // Saying where it went is the difference between a file existing and the
  // user knowing a run survives the window.
  savedTo.textContent = result.savedTo ? `Saved to ${result.savedTo}` : '';
  savedTo.hidden = !result.savedTo;

  renderSpeakerFields(result.segments);
  TABS.transcript.tab.disabled = false;
}

function setBusy(value: boolean): void {
  busy = value;
  startButton.disabled = value || !current;
  startButton.textContent = value ? 'Transcribing…' : 'Transcribe';
  dropzone.classList.toggle('is-disabled', value);
}

/* --- options ----------------------------------------------------------- */

function readSettings(): TranscribeSettings {
  return {
    language: optLanguage.value,
    model: optModel.value,
    speakers: Number(optSpeakers.value),
    align: optAlign.checked,
  };
}

function applySettings(settings: TranscribeSettings): void {
  optLanguage.value = settings.language;
  optModel.value = settings.model;
  optSpeakers.value = String(settings.speakers);
  optAlign.checked = settings.align;
}

/* --- progress ---------------------------------------------------------- */

function showProgress(progress: TranscribeProgress): void {
  progressSection.hidden = false;
  progressPhase.textContent = progress.phase;

  if (progress.percent === null) {
    // Alignment and diarization report nothing, and diarization is about half
    // the wall time. A bar that keeps moving there would be invented.
    progressPercent.textContent = '';
    progressBar.classList.add('is-waiting');
    progressBar.style.width = '100%';
  } else {
    progressPercent.textContent = `${Math.round(progress.percent)}%`;
    progressBar.classList.remove('is-waiting');
    progressBar.style.width = `${progress.percent}%`;
  }
}

function clearProgress(): void {
  progressSection.hidden = true;
  progressBar.classList.remove('is-waiting');
  progressBar.style.width = '0%';
}

/* --- actions ----------------------------------------------------------- */

async function loadFile(path: string | null): Promise<void> {
  if (!path || busy) return;

  clearFile();
  clearResult();
  clearProgress();
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
  showStatus('The first run downloads models and can take a long time.');
  logLine.hidden = false;
  logLine.textContent = '';

  const result = await window.api.transcribe(current.path, readSettings());
  setBusy(false);
  clearProgress();

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
  // The run is over and the transcript is the point of it.
  showTab('transcript');
}

async function exportTranscript(): Promise<void> {
  exportButton.disabled = true;
  exportState.hidden = true;

  const outcome = await window.api.exportTranscript(
    exportFormat.value as ExportFormat,
    speakerNames,
  );
  exportButton.disabled = false;

  if ('error' in outcome) {
    exportState.textContent = outcome.error;
    exportState.classList.add('is-error');
    exportState.hidden = false;
    return;
  }

  // Closing the dialog is a decision, not a failure; it gets no message.
  if ('canceled' in outcome) return;

  exportState.textContent = `Exported to ${outcome.path}`;
  exportState.classList.remove('is-error');
  exportState.hidden = false;
}

const MASK = '••••••••••••••••';

/**
 * The field holds literal bullets, not the token, once one is stored. They
 * select like real content, but selecting and copying yields bullets — the
 * token itself never leaves the main process, so there is nothing here to
 * leak. dataset.masked marks the value as a stand-in rather than input.
 */
async function refreshTokenState(): Promise<void> {
  const preview = await window.api.getTokenPreview();

  if (preview) {
    tokenInput.value = MASK;
    tokenInput.dataset.masked = 'true';
    tokenInput.classList.add('is-masked');
  } else {
    tokenInput.value = '';
    delete tokenInput.dataset.masked;
    tokenInput.classList.remove('is-masked');
  }
  tokenInput.placeholder = 'hf_…';
  saveTokenButton.textContent = preview ? 'Replace' : 'Save';

  tokenState.textContent = preview ? `Saved · ${preview}` : 'Not set';
  tokenPath.textContent = await window.api.getConfigPath();
}

/** Typing over the stand-in clears it, so the bullets are never mixed into a
 *  real value. */
function clearMask(): void {
  if (tokenInput.dataset.masked) {
    tokenInput.value = '';
    delete tokenInput.dataset.masked;
    tokenInput.classList.remove('is-masked');
  }
}

/** Saving cleared the field and changed one dim word, which read as nothing
 *  happening. Flash the line so the click visibly lands. */
function flashTokenState(): void {
  tokenState.classList.add('is-fresh');
  setTimeout(() => tokenState.classList.remove('is-fresh'), 1200);
}

/* --- tabs -------------------------------------------------------------- */

function showTab(which: TabName): void {
  for (const [name, { tab, panel }] of Object.entries(TABS)) {
    const active = name === which;
    panel.hidden = !active;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
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

exportButton.addEventListener('click', () => {
  void exportTranscript();
});

// Selecting is fine; taking a copy out is not. This blocks the stand-in
// bullets and, more usefully, a real token sitting in the field before it is
// saved. Paste stays allowed — that is how the token gets in.
for (const event of ['copy', 'cut', 'dragstart'] as const) {
  tokenInput.addEventListener(event, (e) => e.preventDefault());
}

tokenInput.addEventListener('beforeinput', clearMask);

// The bullets are not selectable, so there is nothing to click into: focusing
// empties the field to type a replacement. Leaving it untouched puts them back,
// so a stray click does not read as "the token is gone".
tokenInput.addEventListener('focus', clearMask);
tokenInput.addEventListener('blur', () => {
  if (!tokenInput.value.trim()) void refreshTokenState();
});

saveTokenButton.addEventListener('click', () => {
  const value = tokenInput.value.trim();
  // Saving the stand-in would store bullets as the token.
  if (!value || tokenInput.dataset.masked) return;
  void window.api.setToken(value).then(async () => {
    tokenInput.value = '';
    await refreshTokenState();
    flashTokenState();
    clearStatus();
  });
});

// whisperx is chatty and its last line is the most informative, so the log
// shows one line rather than growing without bound.
window.api.onProgress((progress) => {
  showProgress(progress);
  logLine.textContent = progress.line;
});

for (const [name, { tab }] of Object.entries(TABS)) {
  tab.addEventListener('click', () => showTab(name as TabName));
}

void refreshTokenState();
void window.api.getSettings().then(applySettings);

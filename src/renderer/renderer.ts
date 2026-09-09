const dropzone = document.getElementById('dropzone') as HTMLButtonElement;
const statusLine = document.getElementById('status') as HTMLParagraphElement;
const fileSection = document.getElementById('file') as HTMLElement;
const fileName = document.getElementById('fileName') as HTMLElement;
const fileMeta = document.getElementById('fileMeta') as HTMLElement;
const filePath = document.getElementById('filePath') as HTMLElement;

/* --- formatting -------------------------------------------------------- */

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '时长未知';

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
  fileName.textContent = info.name;
  fileMeta.textContent = [formatDuration(info.durationSec), formatSize(info.sizeBytes)].join(' · ');
  filePath.textContent = info.path;
  fileSection.hidden = false;
}

function clearFile(): void {
  fileSection.hidden = true;
}

async function loadFile(path: string | null): Promise<void> {
  if (!path) return;

  clearFile();
  showStatus('正在读取…');

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
  if (isFileDrag(event)) setDragging(true);
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

/* --- file picker ------------------------------------------------------- */

dropzone.addEventListener('click', () => {
  void window.api.chooseFile().then(loadFile);
});

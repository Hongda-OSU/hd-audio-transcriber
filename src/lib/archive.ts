// What the transcripts folder knows about itself.
//
// whisperx's JSON says nothing about where it came from: no audio path, no
// settings, no runtime. Eight runs of the same recording are eight files
// telling apart only by their timestamp. This keeps that alongside them, in
// one index.json in the same folder — beside the data it describes, so a
// backup or a move carries both, and one extra file rather than one per run.
//
// No Electron in here: the directory is passed in, the way whisperx.ts takes
// its archive directory rather than resolving one.

import { chmod, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseTranscript } from './whisperx';

const INDEX = 'index.json';

/** What the index keeps per run. The file name is the key, and the path and
 *  the date come from the directory, so none of the three is stored. */
type StoredRun = Omit<ArchivedRun, 'file' | 'path' | 'savedAt'>;

interface IndexFile {
  runs?: Record<string, StoredRun>;
}

function indexPath(dir: string): string {
  return join(dir, INDEX);
}

/** A missing or unreadable index is an empty one. It is a convenience over the
 *  files, never the record of what exists — the folder is that. */
async function readIndex(dir: string): Promise<Record<string, StoredRun>> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(dir), 'utf8')) as IndexFile;
    return parsed.runs ?? {};
  } catch {
    return {};
  }
}

async function writeIndex(dir: string, runs: Record<string, StoredRun>): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  // Same mode as the transcripts themselves: this holds audio paths and the
  // names the user typed, which say as much about a recording as its text.
  // chmod as well as the mode: writeFile only sets it on a file it creates, so
  // an index that already exists keeps whatever it was made with.
  await writeFile(indexPath(dir), `${JSON.stringify({ runs }, null, 2)}\n`, { mode: 0o600 });
  await chmod(indexPath(dir), 0o600);
}

/** Merges what we now know about one run. Fields left out are kept. */
export async function recordRun(dir: string, file: string, entry: StoredRun): Promise<void> {
  try {
    const runs = await readIndex(dir);
    runs[file] = { ...runs[file], ...entry };
    await writeIndex(dir, runs);
  } catch {
    // An unwritable index costs a listing some detail, never a transcript.
  }
}

/** The timestamp this app puts in the file name: stem-YYYY-MM-DD-HH-MM-SS. */
const STAMPED = /-(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/;

function savedAtFromName(file: string): string | undefined {
  const match = STAMPED.exec(file);
  return match ? `${match[1]} ${match[2]}:${match[3]}:${match[4]}` : undefined;
}

/**
 * Every archived run, newest first.
 *
 * Driven by the directory, not the index: a file the index has never heard of
 * still lists, with whatever the name and the filesystem can say. The eight
 * runs made before this index existed are exactly that case.
 */
export async function listRuns(dir: string): Promise<ArchivedRun[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const runs = await readIndex(dir);
  const out: ArchivedRun[] = [];

  for (const file of names) {
    if (!file.endsWith('.json') || file === INDEX) continue;

    const path = join(dir, file);
    let savedAt = savedAtFromName(file);
    if (!savedAt) {
      try {
        savedAt = (await stat(path)).mtime.toISOString().replace('T', ' ').slice(0, 19);
      } catch {
        continue; // Gone between the listing and the stat.
      }
    }

    out.push({ ...runs[file], file, path, savedAt });
  }

  return out.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Reads one archived run back through the same parser a live run goes
 *  through, so an old transcript and a fresh one are the same thing. */
export async function readArchive(path: string): Promise<TranscribeResult> {
  const raw = await readFile(path, 'utf8');
  return { ...parseTranscript(raw), savedTo: path };
}

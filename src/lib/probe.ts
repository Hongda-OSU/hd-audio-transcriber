import { accessSync, constants } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, delimiter, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// A packaged .app launched from Finder does not inherit the shell's PATH, so a
// bare `ffprobe` would resolve in development and fail after M6. Look in the
// Homebrew prefixes first and treat PATH as the fallback, not the source.
const FFPROBE_CANDIDATES = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe'];

/** An error whose message is safe to show the user as-is. */
export class ProbeError extends Error {}

let cachedFfprobe: string | null = null;

function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveFfprobe(): string {
  if (cachedFfprobe) return cachedFfprobe;

  const fromPath = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, 'ffprobe'));

  for (const candidate of [...FFPROBE_CANDIDATES, ...fromPath]) {
    if (isExecutable(candidate)) {
      cachedFfprobe = candidate;
      return cachedFfprobe;
    }
  }

  throw new ProbeError('Cannot find ffprobe. Install ffmpeg first: brew install ffmpeg');
}

interface FfprobeOutput {
  format?: { duration?: string; format_name?: string };
  streams?: Array<{ duration?: string }>;
}

/**
 * Read a file's duration and container format.
 *
 * There is no extension whitelist on purpose — the product spec accepts
 * anything ffmpeg can decode, so ffprobe decides whether a file has audio.
 *
 * @throws {ProbeError} with a message meant for display
 */
export async function probeAudio(filePath: string): Promise<AudioInfo> {
  const ffprobe = resolveFfprobe();

  let size: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) throw new ProbeError('That is not a file.');
    size = stats.size;
  } catch (err) {
    if (err instanceof ProbeError) throw err;
    throw new ProbeError('Cannot read that file — it may have been moved or deleted.');
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      ffprobe,
      [
        '-v', 'error',
        '-show_entries', 'format=duration,format_name',
        '-select_streams', 'a',
        '-show_streams',
        '-of', 'json',
        filePath,
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch (err) {
    // ffprobe prefixes its message with the full path, which the UI shows
    // anyway, and the common case deserves a sentence rather than its wording.
    const raw = (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
    const detail = (raw.trim().split('\n').pop() ?? '').replace(`${filePath}: `, '');

    if (/invalid data found/i.test(detail)) {
      throw new ProbeError('ffmpeg does not recognise this as audio.');
    }
    throw new ProbeError(`ffprobe could not read this file: ${detail}`);
  }

  let probed: FfprobeOutput;
  try {
    probed = JSON.parse(stdout) as FfprobeOutput;
  } catch {
    throw new ProbeError('ffprobe returned something unparseable.');
  }

  const audioStreams = probed.streams ?? [];
  const firstStream = audioStreams[0];
  if (!firstStream) {
    throw new ProbeError('This file has no audio stream.');
  }

  // Container duration is the reliable one, but a few formats only carry it on
  // the stream. Fall back before giving up, since an unknown duration is worth
  // reporting as unknown rather than as an error.
  const duration = Number(probed.format?.duration ?? firstStream.duration);

  return {
    path: filePath,
    name: basename(filePath),
    durationSec: Number.isFinite(duration) ? duration : null,
    sizeBytes: size,
    formatName: probed.format?.format_name ?? '',
  };
}

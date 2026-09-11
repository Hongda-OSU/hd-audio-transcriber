import { accessSync, constants } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

const HOME = process.env.HOME ?? '';

// Searched in order. TRANSCRIBER_ENV comes first so tests can point at a stub —
// planting a fake under a real path would make setup_backend.sh think the venv
// already exists and skip creating it. ~/whisperx-env is where the environment
// actually lives on this machine, built before the script named a path.
const ENV_CANDIDATES = [
  process.env.TRANSCRIBER_ENV,
  `${HOME}/.transcriber-env`,
  `${HOME}/whisperx-env`,
].filter((dir): dir is string => Boolean(dir));

/** An error whose message is safe to show the user as-is. */
export class WhisperxError extends Error {}

/** The run was stopped on purpose. Its own type so the window can tell a
 *  decision from a failure and not paint it red. */
export class WhisperxCancelled extends WhisperxError {}

export interface TranscribeOptions extends TranscribeSettings {
  file: string;
  hfToken: string;
  /**
   * Where to keep whisperx's own JSON. Passed in rather than resolved here so
   * this module stays free of Electron. Without it a run leaves nothing behind:
   * the temp directory is deleted and the result lives only in the window.
   */
  archiveDir?: string;
}

// The lines whisperx prints when it moves on. Only the first reports a
// percentage; everything after it is silent, and on a real interview
// diarization alone is about half the wall time.
const PHASES: Array<[RegExp, string]> = [
  [/voice activity detection/i, 'Detecting speech'],
  [/Performing transcription/i, 'Transcribing'],
  [/Performing alignment/i, 'Aligning words'],
  [/Performing diarization/i, 'Separating speakers'],
];

const PROGRESS_LINE = /Progress:\s*([\d.]+)\s*%/;

/**
 * @throws {WhisperxError} pointing at setup_backend.sh — a missing environment
 * is the expected first-run state, never a crash.
 */
export function resolveEnvDir(): string {
  for (const dir of ENV_CANDIDATES) {
    try {
      accessSync(`${dir}/bin/whisperx`, constants.X_OK);
      return dir;
    } catch {
      // Try the next one.
    }
  }
  throw new WhisperxError(
    `No transcription environment found. Looked in: ${ENV_CANDIDATES.join(', ')}. ` +
      'Run: bash setup_backend.sh',
  );
}

export function resolveWhisperx(): string {
  return `${resolveEnvDir()}/bin/whisperx`;
}

/** Split out from the spawn so the command can be asserted without running it. */
export function buildArgs(opts: TranscribeOptions, outputDir: string): string[] {
  const args = [opts.file, '--model', opts.model];

  // 'auto' means let whisperx detect it, which it does by omitting the flag.
  if (opts.language !== 'auto') args.push('--language', opts.language);

  args.push('--diarize', '--hf_token', opts.hfToken);

  // Alignment is what produces per-word speakers, the only place a speaker
  // change inside a segment survives. Off, whisperx labels the whole segment
  // with one majority speaker.
  if (!opts.align) args.push('--no_align');

  // Zero speakers means whisperx decides how many there are.
  if (opts.speakers > 0) {
    args.push('--min_speakers', String(opts.speakers), '--max_speakers', String(opts.speakers));
  }

  args.push(
    '--print_progress', 'True',
    '--compute_type', 'int8',
    '--output_dir', outputDir,
    '--output_format', 'json',
  );

  return args;
}

/** The same args with the token blanked, for logging. */
export function redactArgs(args: string[]): string[] {
  const i = args.indexOf('--hf_token');
  if (i === -1) return args;
  return args.map((a, n) => (n === i + 1 ? '••••' : a));
}

interface RawWord {
  word?: string;
  start?: number;
  end?: number;
  speaker?: string;
}

interface RawSegment {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
  words?: RawWord[];
}

// Punctuation that closes the sentence before it. Alignment hands the mark to
// the next word, so a split leaves it stranded at the head of the reply:
// "?想过。第二年…" instead of "…想过吗?".
const TRAILING_PUNCTUATION = /^[\s，。！？；：、,.!?;:）)」』”’…]+/;

// A stretch of the other speaker this short, with the speaker before and after
// it agreeing and no pause in front of it, is diarization flicker rather than
// someone talking. On a 54-minute recording it tore single characters out of
// the middle of words, and every one of them cut a sentence in three.
//
// Counted in words, not seconds. A duration limit looks like the safer bound
// and is the wrong one: at a tear the aligner stretches the orphaned character
// across the boundary, so it comes back at a full second while an ordinary
// word runs 0.18s. Flicker is short in tokens and long in time, which is the
// opposite of what it looks like it should be.
//
// Five tokens cannot hold a turn — 「那是一九八七年。」 is eight — so a real
// answer cannot be absorbed into the name of whoever asked the question. That
// is the failure this whole app exists to avoid, and a bound that could not
// rule it out is not worth the segments it would clean up.
const MAX_FLICKER_WORDS = 5;

// Both sides, not just the front. A turn change is someone stopping and
// someone else starting, so there is a beat before it and a beat after it.
// What steals words has neither: one speaker's quiet backchannel never reaches
// the transcript, diarization hears it anyway, and whatever words fall in that
// window are handed over mid-sentence. Checking only the front let every one
// of those through.
const FLICKER_PAUSE = 0.25;

/**
 * Reassigns stretches too short to be speech to whoever was talking either
 * side of them.
 *
 * Mutates the parsed words. The archive keeps whisperx's own text, not this,
 * so the original labels are never overwritten on disk.
 */
function despeckle(words: RawWord[]): void {
  // Where each run of one speaker starts and ends.
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < words.length; ) {
    let j = i;
    while (j < words.length && words[j]?.speaker === words[i]?.speaker) j += 1;
    runs.push([i, j]);
    i = j;
  }

  // Interior runs only: the first and last have nothing on one side to agree.
  for (let k = 1; k < runs.length - 1; k += 1) {
    const run = runs[k];
    const previous = runs[k - 1];
    const next = runs[k + 1];
    if (!run || !previous || !next) continue;

    const [start, end] = run;
    if (end - start > MAX_FLICKER_WORDS) continue;

    const before = words[previous[0]]?.speaker;
    if (before === undefined || before !== words[next[0]]?.speaker) continue;

    // Without timings there is no way to tell flicker from a real interjection,
    // and the transcript is better off keeping a split it cannot justify.
    const opening = words[start]?.start;
    const closing = words[start - 1]?.end;
    const resuming = words[end]?.start;
    const ending = words[end - 1]?.end;
    if (opening === undefined || closing === undefined) continue;
    if (resuming === undefined || ending === undefined) continue;
    if (opening - closing >= FLICKER_PAUSE) continue;
    if (resuming - ending >= FLICKER_PAUSE) continue;

    for (let t = start; t < end; t += 1) {
      const word = words[t];
      if (word) word.speaker = before;
    }
  }
}

/**
 * Re-cuts whisperx's segments wherever the per-word speaker changes.
 *
 * whisperx labels a whole segment with one speaker, so a question and the
 * answer that follows it in the same segment come back as one person. The
 * word-level labels still record the change; this puts the boundaries back.
 *
 * Segments without word timings — alignment turned off — are kept as they are.
 */
function splitBySpeaker(rawSegments: RawSegment[]): Segment[] {
  // Across the whole recording, not per segment: whisperx's segment boundaries
  // have nothing to do with who is speaking, and a flicker at the edge of one
  // would be invisible from inside it.
  despeckle(rawSegments.flatMap((seg) => seg.words ?? []));

  const out: Segment[] = [];
  // Everything built from words[] keeps them, so exports can cut a turn into
  // pieces short enough to read. The no-words branch below has none to keep.
  let current: (Segment & { words: Word[] }) | null = null;
  let lastSpeaker: string | undefined;

  const flush = () => {
    if (current && current.text.trim()) out.push({ ...current, text: current.text.trim() });
    current = null;
  };

  for (const seg of rawSegments) {
    const words = seg.words ?? [];

    if (words.length === 0) {
      flush();
      out.push({
        start: Number(seg.start ?? 0),
        end: Number(seg.end ?? 0),
        text: String(seg.text ?? '').trim(),
        ...(seg.speaker ? { speaker: String(seg.speaker) } : {}),
      });
      continue;
    }

    for (const word of words) {
      const text = String(word.word ?? '');
      // Some words carry no label; they belong to whoever was speaking.
      const speaker = word.speaker ?? lastSpeaker;

      // Not every word is given timings. Falling back to where the segment
      // stands keeps the list monotonic instead of dropping the word.
      const start: number = Number(word.start ?? current?.end ?? seg.start ?? 0);
      const end = Number(word.end ?? start);

      if (current && speaker === current.speaker) {
        current.end = end;
        current.text += text;
        current.words.push({ word: text, start, end });
      } else {
        // Punctuation opening a new speaker's turn closed the previous one.
        const orphan: RegExpExecArray | null = current ? TRAILING_PUNCTUATION.exec(text) : null;
        if (orphan && current) {
          current.text += orphan[0];
          // The mark belongs to the word it closes, or a cue cut from words[]
          // would lose it.
          const last = current.words[current.words.length - 1];
          if (last) last.word += orphan[0];
          flush();
          const rest = text.slice(orphan[0].length);
          if (!rest) {
            lastSpeaker = speaker;
            continue;
          }
        } else {
          flush();
        }

        const head: string = orphan ? text.slice(orphan[0].length) : text;
        current = {
          start,
          end,
          text: head,
          ...(speaker ? { speaker } : {}),
          words: [{ word: head, start, end }],
        };
      }
      if (speaker) lastSpeaker = speaker;
    }
  }

  flush();
  return out;
}

/** whisperx's JSON → the app's segments. Exported because an archived run is
 *  read back through this same function: an old transcript and a fresh one
 *  should not be two different shapes. */
export function parseTranscript(raw: string): TranscribeResult {
  let parsed: { segments?: unknown; language?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new WhisperxError('whisperx produced JSON that could not be parsed.');
  }

  if (!Array.isArray(parsed.segments)) {
    throw new WhisperxError('whisperx output contains no segments.');
  }

  const segments = splitBySpeaker(parsed.segments as RawSegment[]);

  return { segments, language: String(parsed.language ?? '') };
}

let running: ChildProcess | null = null;

/** Whether a run is in flight. Development reloads check this before throwing
 *  away a transcription that may be hours in. */
export function isRunning(): boolean {
  return running !== null;
}

/** Kills an in-flight run — the Stop button, and the window closing, so a long
 *  job does not keep burning CPU after the app is gone. */
export function cancel(): void {
  running?.kill('SIGTERM');
  running = null;
}

/**
 * Turns one stderr line into a progress update, or null if it says nothing.
 * A phase change clears the percentage rather than leaving the last one on
 * screen — a bar frozen at 100% while diarization runs reads as a hang.
 */
function readProgress(line: string, phase: string): TranscribeProgress | null {
  for (const [pattern, name] of PHASES) {
    if (pattern.test(line)) return { phase: name, percent: null, line };
  }

  const match = PROGRESS_LINE.exec(line);
  if (match?.[1]) return { phase, percent: Number(match[1]), line };

  return null;
}

export async function transcribe(
  opts: TranscribeOptions,
  onProgress: (progress: TranscribeProgress) => void,
): Promise<TranscribeResult> {
  const startedAt = Date.now();
  const envDir = resolveEnvDir();
  const bin = `${envDir}/bin/whisperx`;
  const outputDir = await mkdtemp(join(tmpdir(), 'transcriber-'));
  const args = buildArgs(opts, outputDir);

  let phase = 'Starting';
  const report = (line: string) => {
    const next = readProgress(line, phase);
    if (!next) return;
    phase = next.phase;
    onProgress(next);
  };

  onProgress({ phase, percent: null, line: `$ ${bin} ${redactArgs(args).join(' ')}` });

  try {
    await new Promise<void>((resolve, reject) => {
      // A packaged .app inherits no shell PATH, so ffmpeg — which whisperx
      // shells out to — has to be findable from here.
      const child = spawn(bin, args, {
        env: {
          ...process.env,
          PATH: `${envDir}/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
        },
      });
      running = child;

      let tail = '';
      const lines = (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            report(trimmed);
            tail = trimmed;
          }
        }
      };
      child.stderr.on('data', lines);
      child.stdout.on('data', lines);

      child.on('error', () => {
        reject(new WhisperxError(`Could not start whisperx at ${bin}.`));
      });
      child.on('close', (code, signal) => {
        running = null;
        if (signal) return reject(new WhisperxCancelled('Stopped.'));
        if (code !== 0) {
          return reject(new WhisperxError(`whisperx exited with code ${code}${tail ? `: ${tail}` : ''}`));
        }
        resolve();
      });
    });

    // whisperx names the output after the input's stem.
    const stem = basename(opts.file, extname(opts.file));
    const jsonPath = join(outputDir, `${stem}.json`);

    let raw: string;
    try {
      raw = await readFile(jsonPath, 'utf8');
    } catch {
      throw new WhisperxError(`whisperx finished but left no ${stem}.json.`);
    }

    // Written before the temp directory goes. This is the authoritative
    // output — it carries the per-word speakers the UI does not show — so
    // every export and every cleanup pass can be redone from it without
    // spending another two hours on the audio.
    let savedTo: string | undefined;
    if (opts.archiveDir) {
      try {
        await mkdir(opts.archiveDir, { recursive: true, mode: 0o700 });
        // mkdir leaves an existing directory alone, and umask can trim the mode
        // of a new one. The file names alone say who was interviewed.
        await chmod(opts.archiveDir, 0o700);
        const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
        savedTo = join(opts.archiveDir, `${stem}-${stamp}.json`);
        await writeFile(savedTo, raw, { mode: 0o600 });
      } catch {
        // A transcript that cannot be filed is still a transcript; the window
        // has it either way.
        savedTo = undefined;
      }
    }

    return {
      ...parseTranscript(raw),
      ...(savedTo ? { savedTo } : {}),
      elapsedSec: (Date.now() - startedAt) / 1000,
    };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

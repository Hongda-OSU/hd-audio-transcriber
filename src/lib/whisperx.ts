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
   * Names and terms to offer the model, one per line. Not part of
   * TranscribeSettings: those are the choices made per run in the window, and
   * this is typed once in Settings and forgotten, the way the token is.
   */
  glossary?: string;
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

/**
 * YYYY-MM-DD-HH-MM-SS in the clock the user is reading, for the file name a
 * finished run is filed under.
 *
 * Built by hand rather than from `toISOString`, which is UTC: that stamped an
 * 11pm run as 04:00 the next day, and History then filed it under tomorrow.
 */
export function localStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date}-${pad(at.getHours())}-${pad(at.getMinutes())}-${pad(at.getSeconds())}`;
}

/**
 * The glossary as one line for `--hotwords`, or nothing at all.
 *
 * Blank when nothing is typed, and the flag is then left off entirely: an
 * empty hint is still a hint, and whisperx would put the empty string in front
 * of the audio rather than nothing.
 */
export function hotwords(glossary: string | undefined): string {
  return (glossary ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

/** Split out from the spawn so the command can be asserted without running it. */
export function buildArgs(opts: TranscribeOptions, outputDir: string): string[] {
  const args = [opts.file, '--model', opts.model];

  // 'auto' means let whisperx detect it, which it does by omitting the flag.
  if (opts.language !== 'auto') args.push('--language', opts.language);

  // --diarize without --hf_token: the token travels in HF_TOKEN instead, so it
  // never reaches argv, which every other user on the machine can read out of
  // `ps`. huggingface_hub checks that variable before anything else.
  args.push('--diarize');

  // Alignment is what produces per-word speakers, the only place a speaker
  // change inside a segment survives. Off, whisperx labels the whole segment
  // with one majority speaker.
  if (!opts.align) args.push('--no_align');

  // Zero speakers means whisperx decides how many there are.
  if (opts.speakers > 0) {
    args.push('--min_speakers', String(opts.speakers), '--max_speakers', String(opts.speakers));
  }

  // Offered to the model while it listens. Not --initial_prompt, which only
  // reaches the first window and, on Chinese, sends Whisper into a
  // hallucination loop that replaces the transcript with training-data litter.
  const hint = hotwords(opts.glossary);
  if (hint) args.push('--hotwords', hint);

  args.push(
    '--print_progress', 'True',
    '--compute_type', 'int8',
    '--output_dir', outputDir,
    '--output_format', 'json',
  );

  return args;
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

// A word this many times longer than the ones around it was not spoken that
// slowly. At a turn change with no silence in it, the aligner has nothing to
// end the last word on, so it stretches that one character across the gap and
// into the next person's first syllables — and diarization, hearing mostly the
// next person inside those timings, labels it as theirs. 「含义吗」 comes back
// as 「含义」 and 「吗」 said by two people, the 吗 marked 1.7s long where its
// neighbours run 0.24s.
const STRETCH_RATIO = 4;

// Measured against the neighbours rather than a fixed duration: people speed
// up and slow down, and a word that is long for a fast passage is ordinary in
// a slow one.
const LOCAL_WORDS = 12;

function duration(word: RawWord): number {
  return (word.end ?? 0) - (word.start ?? 0);
}

/** The median length of the words around this one, itself excluded. */
function localMedian(words: RawWord[], index: number): number {
  const lengths: number[] = [];
  const from = Math.max(0, index - LOCAL_WORDS);
  const to = Math.min(words.length, index + LOCAL_WORDS);
  for (let i = from; i < to; i += 1) {
    const word = words[i];
    if (i !== index && word?.start !== undefined) lengths.push(duration(word));
  }
  lengths.sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)] ?? 0.2;
}

/**
 * Gives back the first word of a turn when its timings say it was stretched to
 * get there.
 *
 * Only the first word of a run: that is the one the aligner had to stretch, and
 * the only one whose label the stretch explains. Everything after it started
 * inside the new speaker's own audio.
 */
function unstretch(words: RawWord[]): void {
  const starts: number[] = [];
  for (let i = 1; i < words.length; i += 1) {
    if (words[i]?.speaker !== words[i - 1]?.speaker) starts.push(i);
  }

  // Collected first, applied after: measuring against labels this pass has
  // already changed would let one long word walk a boundary along the line.
  const giveBack: number[] = [];
  for (const start of starts) {
    const first = words[start];
    if (!first || first.start === undefined) continue;
    if (duration(first) >= localMedian(words, start) * STRETCH_RATIO) giveBack.push(start);
  }

  for (const start of giveBack) {
    const word = words[start];
    const previous = words[start - 1];
    if (word && previous) word.speaker = previous.speaker;
  }
}

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
  const words = rawSegments.flatMap((seg) => seg.words ?? []);
  // Boundaries first, then flicker: putting a stretched word back where it
  // belongs can leave a run of two or three that is flicker, and despeckle is
  // what that is for.
  unstretch(words);
  despeckle(words);

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

  // Printable as it stands: buildArgs keeps the token out of the arguments, so
  // there is nothing here to remember to hide.
  onProgress({ phase, percent: null, line: `$ ${bin} ${args.join(' ')}` });

  try {
    await new Promise<void>((resolve, reject) => {
      // A packaged .app inherits no shell PATH, so ffmpeg — which whisperx
      // shells out to — has to be findable from here.
      const child = spawn(bin, args, {
        env: {
          ...process.env,
          PATH: `${envDir}/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? ''}`,
          // Where the diarization token is handed over. An environment is
          // readable by this process's children and nobody else; argv is
          // readable by anyone with an account here.
          HF_TOKEN: opts.hfToken,
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
        savedTo = join(opts.archiveDir, `${stem}-${localStamp(new Date())}.json`);
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

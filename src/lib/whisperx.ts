import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

export interface TranscribeOptions {
  file: string;
  language: string;
  model: string;
  minSpeakers: number;
  maxSpeakers: number;
  hfToken: string;
}

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
  return [
    opts.file,
    '--model', opts.model,
    '--language', opts.language,
    '--diarize',
    // Alignment stays on. It is what produces per-word speakers, and those are
    // the only place a speaker change inside a segment survives — whisperx
    // itself collapses each segment to a single majority label.
    // Roughly 1.9x realtime instead of 1.2x; M3 makes it a choice.
    '--min_speakers', String(opts.minSpeakers),
    '--max_speakers', String(opts.maxSpeakers),
    '--hf_token', opts.hfToken,
    '--compute_type', 'int8',
    '--output_dir', outputDir,
    '--output_format', 'json',
  ];
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
  const out: Segment[] = [];
  let current: Segment | null = null;
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

      if (current && speaker === current.speaker) {
        current.end = Number(word.end ?? current.end);
        current.text += text;
      } else {
        // Punctuation opening a new speaker's turn closed the previous one.
        const orphan: RegExpExecArray | null = current ? TRAILING_PUNCTUATION.exec(text) : null;
        if (orphan && current) {
          current.text += orphan[0];
          flush();
          const rest = text.slice(orphan[0].length);
          if (!rest) {
            lastSpeaker = speaker;
            continue;
          }
        } else {
          flush();
        }

        current = {
          start: Number(word.start ?? seg.start ?? 0),
          end: Number(word.end ?? seg.end ?? 0),
          text: orphan ? text.slice(orphan[0].length) : text,
          ...(speaker ? { speaker } : {}),
        };
      }
      if (speaker) lastSpeaker = speaker;
    }
  }

  flush();
  return out;
}

function parseOutput(raw: string): TranscribeResult {
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

/** Kills an in-flight run. Called when the window closes, so a long job does
 *  not keep burning CPU after the app is gone. */
export function cancel(): void {
  running?.kill('SIGTERM');
  running = null;
}

export async function transcribe(
  opts: TranscribeOptions,
  onLog: (line: string) => void,
): Promise<TranscribeResult> {
  const envDir = resolveEnvDir();
  const bin = `${envDir}/bin/whisperx`;
  const outputDir = await mkdtemp(join(tmpdir(), 'transcriber-'));
  const args = buildArgs(opts, outputDir);

  onLog(`$ ${bin} ${redactArgs(args).join(' ')}`);

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
            onLog(trimmed);
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
        if (signal) return reject(new WhisperxError('Transcription cancelled.'));
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

    return parseOutput(raw);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

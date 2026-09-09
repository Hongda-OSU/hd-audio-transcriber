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
    // Alignment is off per the spec: it costs a lot of time and the coarse
    // segment boundaries it leaves are cleaned up in the tidy-up pass.
    '--no_align',
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

  const segments: Segment[] = parsed.segments.map((s) => {
    const seg = s as Partial<Segment>;
    return {
      start: Number(seg.start ?? 0),
      end: Number(seg.end ?? 0),
      text: String(seg.text ?? '').trim(),
      ...(seg.speaker ? { speaker: String(seg.speaker) } : {}),
    };
  });

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

// Turns a finished transcript into the file formats it leaves the app in.
//
// cleanup lives in its own file: it is a long piece of the user's own prose
// rather than a format, and keeping it here would bury the formats under it.
//
// No Electron here, the way probe.ts and whisperx.ts have none: a format is a
// pure function of segments, and one that can be tested without a window is
// one that gets tested.

import { toCleanup } from './cleanup';
import { speakerName } from './speakers';

/** What every renderer below is handed. */
export interface ExportInput {
  segments: Segment[];
  /** Shown in the JSON header; empty when whisperx reported nothing. */
  language?: string;
  /** SPEAKER_00 → "Interviewer". Labels left out keep their own name. */
  names?: SpeakerNames;
  /** Where the recording was. Only the cleanup bundle says so, and only to
   *  name the thing being worked on; an archived run may not know it. */
  audio?: string;
}

export const EXTENSIONS: Record<ExportFormat, string> = {
  txt: 'txt',
  srt: 'srt',
  vtt: 'vtt',
  json: 'json',
  cleanup: 'md',
};

// Re-exported: it was defined here before cleanup.ts needed it too, and the
// callers that import it from here should not have to care that it moved.
export { speakerName };

/* --- time -------------------------------------------------------------- */

/** 00:01:02,340 for srt, 00:01:02.340 for vtt. */
function clock(seconds: number, mark: ',' | '.'): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const ms = Math.round((safe - whole) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');

  return (
    `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}` +
    `${mark}${pad(ms, 3)}`
  );
}

/** 4:07, or 1:23:45 once it runs past an hour. */
function shortClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const pad = (n: number) => String(n).padStart(2, '0');
  const minutes = Math.floor((total % 3600) / 60);

  return total >= 3600
    ? `${Math.floor(total / 3600)}:${pad(minutes)}:${pad(total % 60)}`
    : `${minutes}:${pad(total % 60)}`;
}

/* --- subtitle cues ------------------------------------------------------ */

// A segment is one speaker's whole turn, which in an interview runs to half a
// minute. As a subtitle that is unreadable, so srt and vtt cut it on the word
// timings alignment produced.
const CUE_MAX_WIDTH = 42;
const CUE_MAX_SECONDS = 7;
// Half a cue is enough to end on if the sentence ends there; three quarters
// for the weaker break a comma offers.
const SENTENCE_BREAK = 0.5;
const CLAUSE_BREAK = 0.75;

const SENTENCE_END = /[。！？!?…][”’"')）」』]*$/;
const CLAUSE_END = /[，、；：,;:][”’"')）」』]*$/;

// CJK glyphs occupy two columns, so counting characters would let a Chinese
// cue run twice as wide as an English one.
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;

/** Columns a line takes up, which is what a cue's limit is measured in —
 *  counting characters would let a Chinese cue run twice as long. */
export function displayWidth(text: string): number {
  let total = 0;
  for (const ch of text) total += WIDE.test(ch) ? 2 : 1;
  return total;
}

export interface Cue {
  start: number;
  end: number;
  speaker?: string;
  text: string;
}

/** Cuts one segment into cues short enough to read. Without word timings
 *  there is nothing to cut on and the segment comes back whole. */
export function cuesFor(segment: Segment): Cue[] {
  const words = segment.words ?? [];
  const speaker = segment.speaker ? { speaker: segment.speaker } : {};

  if (words.length === 0) {
    return [{ start: segment.start, end: segment.end, ...speaker, text: segment.text }];
  }

  const out: Cue[] = [];
  let buffer: Word[] = [];

  const flush = () => {
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    if (!first || !last) return;

    const text = buffer.map((w) => w.word).join('').trim();
    if (text) {
      // A zero-length cue is skipped by some players; give it a moment.
      out.push({ start: first.start, end: Math.max(last.end, first.start + 0.2), ...speaker, text });
    }
    buffer = [];
  };

  for (const word of words) {
    // Closed before the word goes in, not after: a cue that has already
    // crossed the limit is a cue that was cut too late.
    const open = buffer[0];
    if (open) {
      const grown = buffer.map((w) => w.word).join('') + word.word;
      if (displayWidth(grown.trim()) > CUE_MAX_WIDTH || word.end - open.start > CUE_MAX_SECONDS) {
        flush();
      }
    }

    buffer.push(word);

    // Ending on a sentence is worth doing early; on a comma, only once the cue
    // is nearly full.
    const first = buffer[0];
    if (!first) continue;
    const text = buffer.map((w) => w.word).join('').trim();
    const filled = Math.max(
      displayWidth(text) / CUE_MAX_WIDTH,
      (word.end - first.start) / CUE_MAX_SECONDS,
    );

    if (
      (filled >= SENTENCE_BREAK && SENTENCE_END.test(text)) ||
      (filled >= CLAUSE_BREAK && CLAUSE_END.test(text))
    ) {
      flush();
    }
  }

  flush();
  return out;
}

/* --- formats ------------------------------------------------------------ */

/** Who said it on one line, what they said on the next: a long turn stays
 *  readable where "Name: …" would wrap into the margin. */
export function toTxt({ segments, names }: ExportInput): string {
  const blocks = segments.map((segment) => {
    const who = speakerName(segment.speaker, names);
    const head = who ? `${shortClock(segment.start)}  ${who}` : shortClock(segment.start);
    return `${head}\n${segment.text}`;
  });

  return `${blocks.join('\n\n')}\n`;
}

export function toSrt({ segments, names }: ExportInput): string {
  const cues = segments.flatMap(cuesFor);

  const blocks = cues.map((cue, index) => {
    const who = speakerName(cue.speaker, names);
    return [
      String(index + 1),
      `${clock(cue.start, ',')} --> ${clock(cue.end, ',')}`,
      who ? `${who}: ${cue.text}` : cue.text,
    ].join('\n');
  });

  return `${blocks.join('\n\n')}\n`;
}

export function toVtt({ segments, names }: ExportInput): string {
  const cues = segments.flatMap(cuesFor);

  const blocks = cues.map((cue) => {
    const who = speakerName(cue.speaker, names);
    return [
      `${clock(cue.start, '.')} --> ${clock(cue.end, '.')}`,
      who ? `${who}: ${cue.text}` : cue.text,
    ].join('\n');
  });

  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

/**
 * The transcript as the app understands it. Word timings are left out: they
 * are in the archived whisperx JSON, and this file is meant to be read by the
 * next program along, not to replace the original.
 */
export function toJson({ segments, language, names }: ExportInput): string {
  const speakers: SpeakerNames = {};
  for (const segment of segments) {
    if (segment.speaker && !speakers[segment.speaker]) {
      speakers[segment.speaker] = speakerName(segment.speaker, names);
    }
  }

  return `${JSON.stringify(
    {
      language: language ?? '',
      speakers,
      segments: segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        ...(segment.speaker
          ? { speaker: segment.speaker, name: speakerName(segment.speaker, names) }
          : {}),
        text: segment.text,
      })),
    },
    null,
    2,
  )}\n`;
}

const RENDERERS: Record<ExportFormat, (input: ExportInput) => string> = {
  txt: toTxt,
  srt: toSrt,
  vtt: toVtt,
  json: toJson,
  cleanup: toCleanup,
};

export function render(format: ExportFormat, input: ExportInput): string {
  return RENDERERS[format](input);
}

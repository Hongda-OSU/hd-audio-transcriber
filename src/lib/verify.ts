// Checking a cleaned-up document against the transcript it came from.
//
// The cleanup step is a language model, and on a real interview it rewrote a
// name the recording states three times — then wrote a note saying the audio
// had said something else, which it had not. A fabricated correction is worse
// than none: whoever checks the list reads "the audio said X, I changed it to
// Y" and ticks it off, never suspecting that X was invented too.
//
// Rules in the prompt only lower the rate. This does not ask: it looks the
// characters up. A name that is not in the transcript is not in the transcript.
//
// No Electron, no model, no network — two strings in, a list out.

/** A stretch of the document whose characters are not in the transcript. */
interface Unsourced {
  /** The characters themselves, as the document writes them. */
  text: string;
  /** Enough of the document around it to recognise where it came from. */
  context: string;
}

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const CONTEXT = 12;

function isHan(ch: string): boolean {
  return HAN.test(ch);
}

/** The transcript with everything but Han characters taken out, so that a
 *  lookup is not defeated by the punctuation the cleanup step adds. Whisper
 *  writes almost none of its own — six marks in eleven thousand characters on
 *  the recording this was built for — so the two sides only line up once both
 *  are stripped. */
function hanOnly(text: string): string {
  let out = '';
  for (const ch of text) if (isHan(ch)) out += ch;
  return out;
}

/** The document split into runs of Han characters. Runs matter: a pair taken
 *  across a comma is not a word the writer wrote, and reporting it would bury
 *  the real findings in noise. */
function hanRuns(text: string): string[] {
  const runs: string[] = [];
  let run = '';
  for (const ch of text) {
    if (isHan(ch)) run += ch;
    else if (run) {
      runs.push(run);
      run = '';
    }
  }
  if (run) runs.push(run);
  return runs;
}

/**
 * Every stretch of `document` that cannot be found in `transcript`.
 *
 * A pair of adjacent characters is the unit: single characters are too common
 * to mean anything, and anything longer would miss a two-character name. Pairs
 * that fail next to each other are one finding rather than several, so a name
 * the cleanup step invented is reported once, with the words around it.
 *
 * What comes back is a list to read, not a verdict. The cleanup step is
 * supposed to add connectives and tidy phrasing, and those are unsourced too;
 * they are short and dull, and the findings are ordered longest first so the
 * ones worth looking at are at the top.
 */
export function unsourced(document: string, transcript: string): Unsourced[] {
  const source = hanOnly(transcript);
  if (!source) return [];

  const found = new Map<string, Unsourced>();

  for (const run of hanRuns(document)) {
    // Which positions start a pair the transcript has never seen.
    const broken: boolean[] = [];
    for (let i = 0; i + 2 <= run.length; i += 1) {
      broken[i] = !source.includes(run.slice(i, i + 2));
    }

    let i = 0;
    while (i < broken.length) {
      if (!broken[i]) {
        i += 1;
        continue;
      }

      // Run of failing pairs: the first covers two characters, each one after
      // it adds a third, a fourth, and so on.
      let end = i;
      while (broken[end + 1]) end += 1;

      const text = run.slice(i, end + 2);
      if (!found.has(text)) {
        const from = Math.max(0, i - CONTEXT);
        const to = Math.min(run.length, end + 2 + CONTEXT);
        found.set(text, {
          text,
          context: `${from > 0 ? '…' : ''}${run.slice(from, to)}${to < run.length ? '…' : ''}`,
        });
      }

      i = end + 1;
    }
  }

  // Longest first: an invented name runs to three or four characters, while
  // the joining words a cleanup legitimately adds are almost always two.
  return [...found.values()].sort(
    (a, b) => b.text.length - a.text.length || a.text.localeCompare(b.text),
  );
}

/** The findings as a report to read, or a line saying there are none. */
export function report(findings: Unsourced[]): string {
  if (findings.length === 0) return 'Every run of characters in the document is in the transcript.';

  const lines = findings.map((f) => `${f.text}\n    ${f.context}`);
  return [
    `${findings.length} stretch${findings.length === 1 ? '' : 'es'} of the document are not in the transcript.`,
    'Longest first. Added punctuation and joining words are expected; names are not.',
    '',
    ...lines,
  ].join('\n');
}

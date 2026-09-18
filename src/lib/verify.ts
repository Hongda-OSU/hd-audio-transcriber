// Checking a cleaned-up document against the transcript it came from.
//
// The cleanup step is a language model, and on a real interview it rewrote a
// name the recording states three times — then wrote a note saying the audio
// had said something else, which it had not. A fabricated correction is worse
// than none: whoever checks the list reads "the audio said X, I changed it to
// Y" and ticks it off, never suspecting that X was invented too.
//
// Rules in the prompt only lower the rate. This does not ask: it looks the
// characters up.
//
// The first version of this file compared every pair of adjacent characters,
// and on a real document it reported 381 findings that were almost all
// innocent. The cleanup step is asked to delete filler and merge stammered
// repetitions, and every deletion joins two characters that were never
// neighbours in the transcript. A thirteen-thousand-character document edited
// down from ten thousand will do that hundreds of times. The unit was wrong,
// not the threshold.
//
// What survives that is quotation. When the document says the transcript reads
// «…», the claim is exact and can be checked exactly — and it is the claim
// that failed.
//
// No Electron, no model, no network — two strings in, a report out.

/** One thing the document says the transcript contains. */
export interface Quotation {
  /** The timestamp the item carries, when it has one: `12:27`. */
  at?: string;
  /** The quoted text, as the document writes it. */
  text: string;
  /** Whether the transcript contains it, punctuation aside. */
  found: boolean;
}

/** A character the document uses that the transcript never does. */
export interface NovelCharacter {
  char: string;
  /** How many times the document body uses it. */
  count: number;
  /** The first place it appears, to read it in. */
  context: string;
}

export interface DocumentCheck {
  /** Every claim about the transcript, in the order the document makes them. */
  quotations: Quotation[];
  /**
   * Characters in the prose that are not in the transcript at all. Editing can
   * put two characters side by side that never met, but it cannot introduce a
   * character out of nothing — so unlike a pair, a novel character is always
   * something the cleanup step chose to write.
   */
  novel: NovelCharacter[];
  /** True when the document has no list of things to confirm. */
  unchecked: boolean;
}

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
const WORD = /[㐀-䶿一-鿿豈-﫿A-Za-z0-9]/;
const CONTEXT = 14;

/**
 * The comparable part of a string: letters, digits and Han, nothing else.
 *
 * Whisper writes almost no punctuation — six marks in eleven thousand
 * characters on the recording this was built for — while the cleanup step is
 * told to add it everywhere, so the two only line up once both are stripped.
 * Latin stays: a name written in it is still a name, and dropping it would
 * make «Amy妈妈» match on 妈妈 alone.
 */
function comparable(text: string): string {
  let out = '';
  for (const ch of text) if (WORD.test(ch)) out += ch;
  return out;
}

/** Where the list of things to confirm begins. Everything from there on is the
 *  cleanup step writing about its own work, and none of it is transcript. */
function splitAtConfirmations(document: string): { prose: string; confirmations: string } {
  const lines = document.split('\n');
  const start = lines.findIndex((line) => /^\s*#{1,6}\s.*待确认/.test(line));
  return start === -1
    ? { prose: document, confirmations: '' }
    : { prose: lines.slice(0, start).join('\n'), confirmations: lines.slice(start).join('\n') };
}

/**
 * The quotations an item makes about the transcript.
 *
 * An item reads `〔12:27〕原文「…」 → 建议「…」`: what is claimed on the left of
 * the arrow, what is proposed on the right. Only the left is a claim about the
 * recording — the right is meant not to be in it — so the arrow is where
 * reading stops. Items in the wild also write 转录作 for 原文; both are the
 * same claim, and neither is required to be matched, because a quotation
 * before the arrow is a quotation whatever introduces it.
 */
function claims(confirmations: string): { at?: string; text: string }[] {
  const out: { at?: string; text: string }[] = [];

  for (const line of confirmations.split('\n')) {
    const claimed = line.split(/[→⇒]|->/)[0] ?? '';

    // The timestamp nearest in front of each quotation, when the item has one.
    let at: string | undefined;
    for (const piece of claimed.split(/(?=〔|\[)/)) {
      const stamp = /[〔[]\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[〕\]]/.exec(piece);
      if (stamp?.[1]) at = stamp[1];

      for (const quote of piece.match(/[「『][^」』\n]+[」』]/g) ?? []) {
        const text = quote.slice(1, -1).trim();
        // A one-character quotation is a letter being discussed, not a passage
        // being cited, and it would match almost any transcript.
        if (comparable(text).length >= 2) out.push(at ? { at, text } : { text });
      }
    }
  }

  return out;
}

/** The lines of the prose that carry speech: not the titles and notes the
 *  cleanup step was asked to compose, and not the roster at the top. */
function spoken(prose: string): string {
  return prose
    .split('\n')
    .filter((line) => !/^\s*(#|>|[-*+]\s|\d+[.)]\s)/.test(line))
    .join('\n');
}

function novelCharacters(prose: string, transcript: string): NovelCharacter[] {
  const seen = new Set([...transcript].filter((ch) => HAN.test(ch)));
  const body = spoken(prose);
  const found = new Map<string, NovelCharacter>();

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] as string;
    if (!HAN.test(ch) || seen.has(ch)) continue;

    const already = found.get(ch);
    if (already) {
      already.count += 1;
      continue;
    }

    const line = body.slice(body.lastIndexOf('\n', i) + 1, body.indexOf('\n', i) + 1 || undefined);
    const at = i - (body.lastIndexOf('\n', i) + 1);
    found.set(ch, {
      char: ch,
      count: 1,
      context: line.slice(Math.max(0, at - CONTEXT), at + CONTEXT + 1).trim(),
    });
  }

  return [...found.values()].sort((a, b) => b.count - a.count || a.char.localeCompare(b.char));
}

/**
 * Checks a cleaned-up document against the transcript it was made from.
 *
 * Two questions, and the first is the one that matters: does the transcript
 * actually say what the document says it says? The second is a weaker signal
 * kept because it is nearly free — a character the transcript never uses had
 * to come from somewhere.
 */
export function checkDocument(document: string, transcript: string): DocumentCheck {
  const source = comparable(transcript);
  if (!source) return { quotations: [], novel: [], unchecked: true };

  const { prose, confirmations } = splitAtConfirmations(document);
  const quotations = claims(confirmations).map((claim) => ({
    ...claim,
    found: source.includes(comparable(claim.text)),
  }));

  return {
    quotations,
    novel: novelCharacters(prose, transcript),
    unchecked: confirmations === '',
  };
}

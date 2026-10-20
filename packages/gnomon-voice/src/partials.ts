/**
 * @symbol #gnomon-voice
 * @flow $voice-turn
 *
 * B1 live words (T-2026-10-20-005; rulings V1–V5 in TD-2026-10-20-086; the B0 bench in PROBES.md). PURE: no audio,
 * no engine, no clock. The voice client re-decodes the open segment's tail window every PARTIAL_TICK_MS and folds each
 * hypothesis in here:
 *
 *   LocalAgreement-2: a word becomes COMMITTED when two consecutive decodes agree on it (normalised: lower case, no
 *   punctuation); committed words never shrink. The rest of the newest decode is the unfixed TAIL. A hypothesis that
 *   disagrees INSIDE the committed region (a tokenisation flip such as `river bank` ↔ `riverbank`) commits nothing;
 *   its tail is aligned by the committed characters, so the flip never retracts a committed word.
 *   Trailing punctuation is stripped from the shown line (the model ends every partial with a period; B0).
 *
 *   Window anchoring: the window head moves only to a committed word boundary (`boundaries` → `reanchor`); the words
 *   before it become FROZEN (still shown, never re-decoded). A freely sliding head loses context (B0: `Then run the
 *   tests` → `Through the tests`).
 *
 * The final transcript is NOT made here: it stays the full-segment decode the turn already makes (voice-client.ts).
 * Partials are display only: they never reach log.append, voice.turn.user or session.send.
 */

/** One decoded word; `start` = seconds from the decoded window's first sample (absent when the engine has no timing). */
export interface PartialWord {
  text: string;
  start?: number;
}

/** The live words shown in the GUI ghost line: committed (solid) and the unfixed tail (dim). */
export interface PartialText {
  committed: string;
  tail: string;
}

/** a decode every this much heard audio while a segment is open */
export const PARTIAL_TICK_MS = 600;
/** audio kept from before the segment opened (the VAD's start latency) */
export const PARTIAL_PREROLL_MS = 300;
/** the window decodes from the segment start while the segment is at most this long */
export const PARTIAL_FULL_WINDOW_MS = 6_000;
/** after that, the window is about this long, its head anchored at a committed word boundary */
export const PARTIAL_TAIL_WINDOW_MS = 4_000;
/** never decode a window longer than this (no boundary to anchor at ⇒ the tick is skipped, the line stays) */
export const PARTIAL_MAX_WINDOW_MS = 8_000;
/** an anchored head starts this much before its first word's timestamp */
export const PARTIAL_ANCHOR_MARGIN_MS = 100;
/** V1: no words until a provisional speaker match on this much of the open segment */
export const PARTIAL_GATE_MS = 1_500;
/** the live line is capped at this many characters (committed + tail); the newest words are kept */
export const PARTIAL_TEXT_MAX = 600;
/** a segment longer than this stops buffering for partials (the final decode is unaffected) */
export const PARTIAL_MAX_SEGMENT_MS = 120_000;

/** Lower case, letters and digits only (the B0 comparison). */
export function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

const TRAILING_PUNCT = /[.,!?;:…。、！？]+$/u;
/** Strip an unfinished hypothesis's trailing punctuation. */
export function stripTrailingPunct(w: string): string {
  return w.replace(TRAILING_PUNCT, '');
}

/** Control, bidi, zero-width and separator characters become spaces; whitespace collapses (mirrors the kernel). */
const HIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x0000, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x061c, 0x061c], [0x180e, 0x180e], [0x200b, 0x200f],
  [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
  // Aegis L3: variation selectors, Unicode tag characters, Hangul fillers
  [0xfe00, 0xfe0f], [0xe0100, 0xe01ef], [0xe0000, 0xe007f], [0x115f, 0x115f], [0x3164, 0x3164], [0xffa0, 0xffa0],
];
/** built from code points so no hidden character ever sits literally in this source file */
const HIDDEN = new RegExp(`[${HIDDEN_RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join("")}]`, "gu");
export function sanitizeWords(s: string): string {
  return s
    .replace(HIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sanitise and cap a live line: the NEWEST words are kept (committed words are dropped from the front first). */
export function capPartial(t: PartialText, max = PARTIAL_TEXT_MAX): PartialText {
  let committed = sanitizeWords(t.committed);
  let tail = sanitizeWords(t.tail);
  const cps = (s: string): number => [...s].length;
  if (cps(tail) > max) {
    const chars = [...tail];
    tail = chars.slice(chars.length - max).join('').replace(/^\S*\s?/, '');
    committed = '';
  }
  const room = max - cps(tail) - (tail && committed ? 1 : 0);
  if (cps(committed) > room) {
    const chars = [...committed];
    committed = room > 0 ? chars.slice(chars.length - room).join('').replace(/^\S*\s?/, '') : '';
  }
  return { committed, tail };
}

/** Split a sherpa offline result (`tokens` with a leading space at each word start, `timestamps` in seconds) into words. */
export function wordsOfResult(r: { text?: unknown; tokens?: unknown; timestamps?: unknown }): PartialWord[] {
  const tokens = Array.isArray(r.tokens) ? (r.tokens as unknown[]) : null;
  const ts = Array.isArray(r.timestamps) ? (r.timestamps as unknown[]) : null;
  if (!tokens || !tokens.length) {
    return String(r.text ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ text }));
  }
  const out: PartialWord[] = [];
  tokens.forEach((tok, i) => {
    const s = String(tok ?? '');
    const t = ts && typeof ts[i] === 'number' && Number.isFinite(ts[i]) ? (ts[i] as number) : undefined;
    if (!out.length || /^\s/.test(s)) out.push({ text: s.trim(), ...(t !== undefined ? { start: t } : {}) });
    else out[out.length - 1]!.text += s;
  });
  return out.filter((w) => w.text.length > 0);
}

/** A place the window head may move to: hypothesis word `word` starts at `start` s, and `committed` words lie before it. */
export interface AnchorBoundary {
  word: number;
  committed: number;
  start: number;
}

/** LocalAgreement-2 over the decodes of ONE open segment. */
export class LiveAgreement {
  /** committed words before the window head (display only, never re-decoded) */
  #frozen: string[] = [];
  /** committed words inside the current window (display form) */
  #committed: string[] = [];
  /** the normalised characters of #committed, joined */
  #key = '';
  /** the previous decode's words after the committed region (normalised), or null */
  #prev: string[] | null = null;
  #prevOk = false;
  /** the latest decode (current window coordinates) and where its uncommitted rest starts */
  #last: PartialWord[] = [];
  #lastSplit = 0;
  #lastOk = false;
  #tail: string[] = [];
  /**
   * The anchored head starts PARTIAL_ANCHOR_MARGIN_MS before its first word, so a window's decodes may begin with a
   * fragment (or a repeat) of the last frozen word. Decided on the window's first decode, kept for the window.
   */
  #lead: 'undecided' | 'drop' | 'keep' = 'keep';

  /** Fold one decode of the current window in; returns the live line. */
  push(hyp: readonly PartialWord[]): PartialText {
    let words = hyp.filter((w) => normWord(w.text) !== '');
    if (this.#lead === 'undecided') this.#lead = words.length > 1 && this.#isFragment(normWord(words[0]!.text)) ? 'drop' : 'keep';
    if (this.#lead === 'drop' && words.length && this.#isFragment(normWord(words[0]!.text))) words = words.slice(1);
    const { i, ok } = this.#split(words);
    const rest = words.slice(i);
    const restN = rest.map((w) => normWord(w.text));
    let L = 0;
    if (ok && this.#prevOk && this.#prev) {
      while (L < rest.length && L < this.#prev.length && restN[L] === this.#prev[L]) L++;
      for (let j = 0; j < L; j++) {
        // the last word of either decode carries the model's sentence-final period: never commit it with it
        const last = j === rest.length - 1 || j === this.#prev.length - 1;
        this.#committed.push(last ? stripTrailingPunct(rest[j]!.text) || rest[j]!.text : rest[j]!.text);
      }
      this.#key += restN.slice(0, L).join('');
    }
    this.#prev = restN.slice(L);
    this.#prevOk = ok;
    this.#last = words;
    this.#lastSplit = i + L;
    this.#lastOk = ok;
    this.#tail = rest.slice(L).map((w) => w.text);
    return this.text();
  }

  /** The live line: committed (frozen + window) and the tail; the line's trailing punctuation stripped. */
  text(): PartialText {
    const committed = [...this.#frozen, ...this.#committed];
    const tail = [...this.#tail];
    if (tail.length) tail[tail.length - 1] = stripTrailingPunct(tail[tail.length - 1]!);
    else if (committed.length) committed[committed.length - 1] = stripTrailingPunct(committed[committed.length - 1]!);
    return { committed: committed.filter(Boolean).join(' '), tail: tail.filter(Boolean).join(' ') };
  }

  /** How many words are committed in all (frozen + window). Monotone. */
  get committedCount(): number {
    return this.#frozen.length + this.#committed.length;
  }

  /**
   * Where the window head may move: the start of a word of the latest decode whose preceding words are exactly a
   * prefix of the committed words (aligned by normalised characters). Only when that decode agreed with the committed
   * words and the word has a timestamp.
   */
  boundaries(): AnchorBoundary[] {
    if (!this.#lastOk) return [];
    const out: AnchorBoundary[] = [];
    const cum: number[] = [0];
    for (const w of this.#committed) cum.push(cum[cum.length - 1]! + normWord(w).length);
    let acc = 0;
    for (let m = 1; m <= this.#lastSplit && m < this.#last.length; m++) {
      acc += normWord(this.#last[m - 1]!.text).length;
      const k = cum.indexOf(acc);
      const start = this.#last[m]!.start;
      if (k > 0 && start !== undefined) out.push({ word: m, committed: k, start });
    }
    return out;
  }

  /** The window head moved to boundary `b`: its committed words before it are frozen; the next decode starts at word b.word. */
  reanchor(b: AnchorBoundary): void {
    this.#frozen.push(...this.#committed.slice(0, b.committed));
    this.#committed = this.#committed.slice(b.committed);
    this.#key = this.#committed.map(normWord).join('');
    this.#last = this.#last.slice(b.word).map((w) => ({ text: w.text }));
    this.#lastSplit = Math.max(0, this.#lastSplit - b.word);
    this.#lastOk = false; // timings are in the old window's coordinates: no further anchoring until the next decode
    this.#lead = 'undecided';
  }

  /** the last frozen word, or a piece of it (equal, prefix or suffix) */
  #isFragment(w: string): boolean {
    const f = this.#frozen.length ? normWord(this.#frozen[this.#frozen.length - 1]!) : '';
    return !!f && !!w && (f === w || f.startsWith(w) || f.endsWith(w));
  }

  /** Where the uncommitted rest starts: the shortest prefix whose normalised characters cover the committed key. */
  #split(words: readonly PartialWord[]): { i: number; ok: boolean } {
    if (!this.#key) return { i: 0, ok: true };
    let acc = '';
    for (let i = 0; i < words.length; i++) {
      acc += normWord(words[i]!.text);
      if (acc.length >= this.#key.length) return { i: i + 1, ok: acc === this.#key };
    }
    return { i: words.length, ok: false };
  }
}

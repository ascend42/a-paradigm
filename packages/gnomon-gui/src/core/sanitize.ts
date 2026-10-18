/**
 * @symbol #gui
 *
 * #gui sanitizer (spec §4.5 "Sanitizer", S22-H5 / S25-H6; `G-GUI-07`,
 * `G-GUI-11`). PURE: no DOM. Every string the page shows — a block string, a
 * card body, a transcript line, a refusal message — passes through
 * `sanitizeText` and then reaches the DOM as a TEXT NODE (render.ts); there is
 * no path from kernel or model text to markup.
 *
 *   - Terminal escapes are removed whole: CSI (`ESC [` / U+009B … final byte),
 *     OSC (`ESC ]` / U+009D … BEL or ST — including OSC 52 clipboard and OSC 8
 *     hyperlinks), DCS / SOS / PM / APC (`ESC P X ^ _` / U+0090 U+0098 U+009E
 *     U+009F … ST); an unterminated string sequence is removed to the end; any
 *     other `ESC x` pair is removed.
 *   - C0 controls except `\n` and `\t`, DEL and C1 controls are stripped.
 *   - Bidi controls (U+202A–U+202E, U+2066–U+2069) are NOT stripped: they
 *     render as visible glyphs (`⟨RLO⟩`, `⟨LRI⟩`, …) so no text can be
 *     reversed on screen; flag `bidi`.
 *   - Tag characters (U+E0000–U+E007F) and zero-width characters (U+200B–
 *     U+200D, U+2060, U+FEFF) are stripped (invisible to people, read by
 *     models); flag `hidden-chars`.
 */

export type SanitizeFlag = 'hidden-chars' | 'bidi';

export interface Sanitized {
  text: string;
  flags: SanitizeFlag[];
  /** Count of removed terminal sequences and control characters (diagnostic only, not a card flag). */
  controlsRemoved: number;
}

export const BIDI_GLYPHS: Readonly<Record<number, string>> = Object.freeze({
  0x202a: '⟨LRE⟩',
  0x202b: '⟨RLE⟩',
  0x202c: '⟨PDF⟩',
  0x202d: '⟨LRO⟩',
  0x202e: '⟨RLO⟩',
  0x2066: '⟨LRI⟩',
  0x2067: '⟨RLI⟩',
  0x2068: '⟨FSI⟩',
  0x2069: '⟨PDI⟩',
});

const ESC = 0x1b;
const BEL = 0x07;
const ST_C1 = 0x9c;

const isZeroWidth = (c: number): boolean => (c >= 0x200b && c <= 0x200d) || c === 0x2060 || c === 0xfeff;
const isTag = (c: number): boolean => c >= 0xe0000 && c <= 0xe007f;
const isBidi = (c: number): boolean => (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
const isC0 = (c: number): boolean => c < 0x20 && c !== 0x0a && c !== 0x09;
const isC1 = (c: number): boolean => c >= 0x80 && c <= 0x9f;

/** Code points of a string (surrogate pairs joined; a lone surrogate is kept as is). */
function codePoints(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) out.push(ch.codePointAt(0)!);
  return out;
}

/**
 * Skip a string-type sequence (OSC, DCS, SOS, PM, APC) starting after its
 * introducer at `i`: returns the index after its terminator (BEL for OSC,
 * `ESC \` or U+009C for all), or the end when unterminated.
 */
function skipString(cps: number[], i: number, belEnds: boolean): number {
  for (let j = i; j < cps.length; j++) {
    const c = cps[j]!;
    if (belEnds && c === BEL) return j + 1;
    if (c === ST_C1) return j + 1;
    if (c === ESC && cps[j + 1] === 0x5c) return j + 2;
  }
  return cps.length;
}

/** CSI: parameter bytes 0x30–0x3F, intermediates 0x20–0x2F, one final byte 0x40–0x7E. */
function skipCsi(cps: number[], i: number): number {
  let j = i;
  while (j < cps.length && cps[j]! >= 0x30 && cps[j]! <= 0x3f) j++;
  while (j < cps.length && cps[j]! >= 0x20 && cps[j]! <= 0x2f) j++;
  if (j < cps.length && cps[j]! >= 0x40 && cps[j]! <= 0x7e) return j + 1;
  return j; // malformed: drop what was consumed, keep scanning from here
}

/** The §4.5 sanitizer. Idempotent: sanitizeText(sanitizeText(s).text).text === sanitizeText(s).text. */
export function sanitizeText(input: unknown): Sanitized {
  const s = typeof input === 'string' ? input : input === null || input === undefined ? '' : String(input);
  const cps = codePoints(s);
  let out = '';
  let hidden = false;
  let bidi = false;
  let removed = 0;
  for (let i = 0; i < cps.length; ) {
    const c = cps[i]!;
    if (c === ESC) {
      removed++;
      const n = cps[i + 1];
      if (n === undefined) {
        i++;
      } else if (n === 0x5b) i = skipCsi(cps, i + 2); // [
      else if (n === 0x5d) i = skipString(cps, i + 2, true); // ]
      else if (n === 0x50 || n === 0x58 || n === 0x5e || n === 0x5f) i = skipString(cps, i + 2, false); // P X ^ _
      else i += 2;
      continue;
    }
    if (c === 0x9b) {
      removed++;
      i = skipCsi(cps, i + 1);
      continue;
    }
    if (c === 0x9d) {
      removed++;
      i = skipString(cps, i + 1, true);
      continue;
    }
    if (c === 0x90 || c === 0x98 || c === 0x9e || c === 0x9f) {
      removed++;
      i = skipString(cps, i + 1, false);
      continue;
    }
    if (isC0(c) || c === 0x7f || isC1(c)) {
      removed++;
      i++;
      continue;
    }
    if (isTag(c) || isZeroWidth(c)) {
      hidden = true;
      i++;
      continue;
    }
    if (isBidi(c)) {
      bidi = true;
      out += BIDI_GLYPHS[c]!;
      i++;
      continue;
    }
    out += String.fromCodePoint(c);
    i++;
  }
  const flags: SanitizeFlag[] = [];
  if (hidden) flags.push('hidden-chars');
  if (bidi) flags.push('bidi');
  return { text: out, flags, controlsRemoved: removed };
}

/** Convenience: the sanitized text only. */
export function clean(input: unknown): string {
  return sanitizeText(input).text;
}

/** Union of the flags found in every string of a JSON-like value (a card body, a block tree). */
export function flagsOf(value: unknown, acc: Set<SanitizeFlag> = new Set(), depth = 0): Set<SanitizeFlag> {
  if (depth > 64) return acc;
  if (typeof value === 'string') for (const f of sanitizeText(value).flags) acc.add(f);
  else if (Array.isArray(value)) for (const v of value) flagsOf(v, acc, depth + 1);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) {
    flagsOf(k, acc, depth + 1);
    flagsOf(v, acc, depth + 1);
  }
  return acc;
}

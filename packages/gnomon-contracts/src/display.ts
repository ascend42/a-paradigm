/**
 * Client display rules (spec §4.5 sanitizer + Unicode rules, §4.9 opaque
 * `modns.*` rows, §9.1 `{n, of}`, §12.8 conformance) — the rendering half of
 * the published client API, so a community client can draw from this package
 * alone and two conformant clients draw the same card the same way (M1.12
 * falsifier "two UIs disagree on a card").
 *
 * NOT an input to clientApiId: pure functions, not schemas. The vectors in
 * ../conformance/display.v1.json are NORMATIVE (§4.5): every client (TS,
 * Python, …) must reproduce them byte for byte.
 *
 * THE RULES (§4.5, Aegis round 2), applied in this order. No Unicode
 * normalisation (no NFC/NFKC) is applied, ever.
 *   0. lone surrogates become U+FFFD (visible, no flag);
 *   1. TERMINATED terminal escape sequences are removed whole and flag
 *      `hidden-chars`: OSC / DCS / SOS / PM / APC (7-bit ESC-introduced or
 *      8-bit C1), terminated by BEL, ESC \ or 8-bit ST (U+009C), the body
 *      holding none of those three; CSI (7- or 8-bit) with its final byte;
 *      any other ESC sequence except a string or CSI introducer. An ESC that
 *      starts no terminated sequence (an UNTERMINATED one) becomes the visible
 *      glyph `⟨ESC⟩` (flag) and the tail stays visible — never swallowed;
 *   2. STRIPPED, flag `hidden-chars`: tag characters U+E0000–U+E007F,
 *      variation selectors supplement U+E0100–U+E01EF, U+200B–U+200D,
 *      U+2060–U+2064, U+FEFF, U+00AD, U+180E, U+034F, U+115F, U+1160,
 *      U+3164, U+FFA0; variation selectors U+FE00–U+FE0F are KEPT after a
 *      base that can take one (letter, number, symbol, punctuation, mark)
 *      and stripped + flagged at the start, after any other character, or
 *      as the second and later of a run; U+2028 / U+2029 become `\n` (flag);
 *   3. bidi controls U+202A–U+202E, U+2066–U+2069 and the marks U+200E,
 *      U+200F, U+061C are REPLACED by a visible glyph (`⟨RLO⟩`, …), flag
 *      `bidi` (LRM/RLM in Arabic or Hebrew text therefore badge: accepted);
 *   4. every remaining C0/C1 control and DEL is removed, flag `hidden-chars`,
 *      except `\n` and `\t` (kept) and CR (removed without a flag: CRLF text).
 * Flags are reported in the fixed order [hidden-chars, bidi]. Idempotent.
 */

import { opaqueEventView, isKnownKind, EVENT_KINDS, type EventV1 } from './event.js';
import type { CardFlag } from './card.js';

/** The visible glyph for each bidi control (\u00a74.5), keyed by code point. */
export const BIDI_GLYPHS: Readonly<Record<number, string>> = Object.freeze({
  0x202a: '\u27e8LRE\u27e9',
  0x202b: '\u27e8RLE\u27e9',
  0x202c: '\u27e8PDF\u27e9',
  0x202d: '\u27e8LRO\u27e9',
  0x202e: '\u27e8RLO\u27e9',
  0x2066: '\u27e8LRI\u27e9',
  0x2067: '\u27e8RLI\u27e9',
  0x2068: '\u27e8FSI\u27e9',
  0x2069: '\u27e8PDI\u27e9',
  0x200e: '\u27e8LRM\u27e9',
  0x200f: '\u27e8RLM\u27e9',
  0x061c: '\u27e8ALM\u27e9',
});
/** What an unterminated escape introducer shows as (rule 1). */
export const ESC_GLYPH = '\u27e8ESC\u27e9';

/** Rule 2 strip set (single code points and ranges), exported so other clients can diff against it. */
export const HIDDEN_STRIP_RANGES: ReadonlyArray<readonly [number, number]> = Object.freeze([
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x115f, 0x1160],
  [0x180e, 0x180e],
  [0x200b, 0x200d],
  [0x2060, 0x2064],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
] as const);

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/* eslint-disable no-control-regex */
const TERMINATED = new RegExp(
  [
    '(?:\\x1B[\\]PX^_]|[\\x9D\\x90\\x98\\x9E\\x9F])[^\\x07\\x1B\\x9C]*(?:\\x07|\\x1B\\\\|\\x9C)', // string sequences
    '(?:\\x1B\\[|\\x9B)[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]', // CSI
    '\\x1B[\\x20-\\x2F]*[\\x30-\\x4F\\x51-\\x57\\x59\\x5A\\x5C\\x60-\\x7E]', // other ESC (never a string/CSI introducer)
  ].join('|'),
  'g',
);
/* eslint-enable no-control-regex */
const VS_BASE = /^[\p{L}\p{N}\p{S}\p{P}\p{M}]$/u;

const inStrip = (cp: number): boolean => HIDDEN_STRIP_RANGES.some(([a, b]) => cp >= a && cp <= b);
const isVs = (cp: number): boolean => cp >= 0xfe00 && cp <= 0xfe0f;
const isControl = (cp: number): boolean => cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f);

export interface SanitizedText {
  text: string;
  /** Subset of card flags, in the order [hidden-chars, bidi]. */
  flags: CardFlag[];
}

/** Apply the \u00a74.5 rules to one string (see the header). Idempotent; no normalisation. */
export function sanitizeDisplayText(input: string): SanitizedText {
  let hidden = false;
  let bidi = false;
  let s = String(input).replace(LONE_SURROGATE, '\ufffd');
  s = s.replace(TERMINATED, () => {
    hidden = true;
    return '';
  });
  let out = '';
  let last: string | undefined; // last emitted code point
  let prevVs = false; // the previous INPUT code point was a variation selector
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    const wasVs = prevVs;
    prevVs = isVs(cp);
    if (cp === 0x1b) {
      hidden = true;
      out += ESC_GLYPH;
      last = '\u27e9';
    } else if (inStrip(cp)) {
      hidden = true;
    } else if (isVs(cp)) {
      if (!wasVs && last !== undefined && VS_BASE.test(last)) {
        out += ch;
        last = ch;
      } else hidden = true;
    } else if (cp === 0x2028 || cp === 0x2029) {
      hidden = true;
      out += '\n';
      last = '\n';
    } else if (BIDI_GLYPHS[cp] !== undefined) {
      bidi = true;
      out += BIDI_GLYPHS[cp];
      last = '\u27e9';
    } else if (cp === 0x0d) {
      // CR: removed without a flag (rule 4)
    } else if (isControl(cp) && cp !== 0x0a && cp !== 0x09) {
      hidden = true;
    } else {
      out += ch;
      last = ch;
    }
  }
  const flags: CardFlag[] = [];
  if (hidden) flags.push('hidden-chars');
  if (bidi) flags.push('bidi');
  return { text: out, flags };
}

/** How a client lists one event row (\u00a74.9): a kind the client has no renderer for is shown opaquely, never dropped. */
export interface EventRow {
  kind: string;
  principal: string;
  at: string;
  /** `registered` (in the \u00a79.1 table), `open` (credit/broke), `modns` (a mod kind: always opaque to a generic client), `unknown` (newer than this package). */
  class: 'registered' | 'open' | 'modns' | 'unknown';
  /** True \u21d2 the client shows only {kind, principal, at}. */
  opaque: boolean;
}

/** Classify a kind against this package's registry (\u00a79.1 kind registry). */
export function kindClass(kind: string): EventRow['class'] {
  if (Object.hasOwn(EVENT_KINDS, kind)) return 'registered';
  if (kind.startsWith('modns.') && isKnownKind(kind)) return 'modns';
  if (isKnownKind(kind)) return 'open';
  return 'unknown';
}

/**
 * The row a conformant client lists for an event: every string sanitized;
 * `modns.*` and kinds newer than the package are opaque `{kind, principal, at}`
 * (a client never drops them, §4.9).
 */
export function eventRow(e: Pick<EventV1, 'kind' | 'principal' | 'at'>): EventRow {
  const v = opaqueEventView(e);
  const cls = kindClass(String(v.kind));
  return {
    kind: sanitizeDisplayText(String(v.kind)).text,
    principal: sanitizeDisplayText(String(v.principal)).text,
    at: sanitizeDisplayText(String(v.at)).text,
    class: cls,
    opaque: cls === 'modns' || cls === 'unknown',
  };
}

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/** A count as every Gnomon surface shows it (\u00a79.1 G-HON-03): `{n, of}` of non-negative safe integers \u21d2 "n of of"; anything else is refused. */
export function renderDenominator(v: unknown): string {
  if (typeof v !== 'object' || v === null || !isCount((v as { n?: unknown }).n) || !isCount((v as { of?: unknown }).of)) {
    throw new TypeError('gnomon-contracts: a number is shown as {n, of} of non-negative safe integers (G-HON-03)');
  }
  const { n, of } = v as { n: number; of: number };
  return `${n} of ${of}`;
}

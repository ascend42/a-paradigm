/**
 * Client display rules (spec §4.5 sanitizer + Unicode rules, §4.9 opaque
 * `modns.*` rows, §9.1 `{n, of}`, §12.8 conformance) — the rendering half of
 * the published client API, so a community client can draw from this package
 * alone and two conformant clients draw the same card the same way (M1.12
 * falsifier "two UIs disagree on a card").
 *
 * NOT an input to clientApiId: these are pure functions over strings and
 * events, not schemas; the descriptor (client-api.ts) is unchanged. The
 * conformance vectors in ../conformance/display.v1.json pin their behaviour
 * and every client (TS, Python, …) must reproduce them byte for byte.
 *
 * THE RULES (§4.5), applied in this order to every string a client renders:
 *   1. terminal escape sequences are REMOVED whole: OSC (incl. OSC 52
 *      clipboard and OSC 8 hyperlinks), CSI, DCS, SOS, PM, APC — both the
 *      7-bit (ESC-introduced) and 8-bit (C1) forms; an unterminated string
 *      sequence is removed to the end of the text;
 *   2. tag characters (U+E0000–U+E007F) and zero-width / invisible
 *      characters (U+200B–U+200D, U+2060–U+2064, U+FEFF, U+00AD, U+180E) are
 *      STRIPPED and flag `hidden-chars`;
 *   3. bidi controls (U+202A–U+202E, U+2066–U+2069, and the marks U+200E,
 *      U+200F, U+061C) are NOT stripped but REPLACED by a visible glyph
 *      (`⟨RLO⟩`, `⟨LRI⟩`, …) and flag `bidi`, so no text is reversed on screen;
 *   4. every remaining C0/C1 control and DEL is removed, except `\n` and `\t`.
 * Flags are reported in the fixed order [hidden-chars, bidi].
 */

import { opaqueEventView, isKnownKind, EVENT_KINDS, type EventV1 } from './event.js';
import type { CardFlag } from './card.js';

/** The visible glyph for each bidi control (§4.5). */
export const BIDI_GLYPHS: Readonly<Record<string, string>> = Object.freeze({
  '‪': '⟨LRE⟩',
  '‫': '⟨RLE⟩',
  '‬': '⟨PDF⟩',
  '‭': '⟨LRO⟩',
  '‮': '⟨RLO⟩',
  '⁦': '⟨LRI⟩',
  '⁧': '⟨RLI⟩',
  '⁨': '⟨FSI⟩',
  '⁩': '⟨PDI⟩',
  '‎': '⟨LRM⟩',
  '‏': '⟨RLM⟩',
  '؜': '⟨ALM⟩',
});

/* eslint-disable no-control-regex */
/** 7-bit and 8-bit terminal escape sequences (rule 1). */
const ESCAPES = new RegExp(
  [
    '\\x1B\\][\\s\\S]*?(?:\\x07|\\x1B\\\\|$)', // OSC … BEL | ST | end
    '\\x9D[\\s\\S]*?(?:\\x07|\\x9C|$)', // 8-bit OSC
    '\\x1B[P^_X][\\s\\S]*?(?:\\x1B\\\\|$)', // DCS / PM / APC / SOS … ST | end
    '[\\x90\\x98\\x9E\\x9F][\\s\\S]*?(?:\\x9C|$)', // 8-bit DCS / SOS / PM / APC
    '\\x1B\\[[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]', // CSI
    '\\x9B[\\x30-\\x3F]*[\\x20-\\x2F]*[\\x40-\\x7E]', // 8-bit CSI
    '\\x1B[\\x20-\\x2F]*[\\x30-\\x7E]', // any other ESC sequence (nF / Fp / Fe / Fs)
  ].join('|'),
  'g',
);
const TAGS = /[\u{E0000}-\u{E007F}]/gu;
const HIDDEN = /[​-‍⁠-⁤﻿­᠎]/gu;
const BIDI = /[‪-‮⁦-⁩‎‏؜]/gu;
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
/* eslint-enable no-control-regex */

export interface SanitizedText {
  text: string;
  /** Subset of card flags, in the order [hidden-chars, bidi]. */
  flags: CardFlag[];
}

/** Apply the §4.5 rules to one string (see the header for the order). Idempotent. */
export function sanitizeDisplayText(input: string): SanitizedText {
  let s = String(input).replace(ESCAPES, '');
  let hidden = false;
  let bidi = false;
  s = s.replace(TAGS, () => {
    hidden = true;
    return '';
  });
  s = s.replace(HIDDEN, () => {
    hidden = true;
    return '';
  });
  s = s.replace(BIDI, (c) => {
    bidi = true;
    return BIDI_GLYPHS[c]!;
  });
  s = s.replace(CONTROLS, '');
  const flags: CardFlag[] = [];
  if (hidden) flags.push('hidden-chars');
  if (bidi) flags.push('bidi');
  return { text: s, flags };
}

/** How a client lists one event row (§4.9): a kind the client has no renderer for is shown opaquely, never dropped. */
export interface EventRow {
  kind: string;
  principal: string;
  at: string;
  /** `registered` (in the §9.1 table), `open` (credit/broke), `modns` (a mod kind: always opaque to a generic client), `unknown` (newer than this package). */
  class: 'registered' | 'open' | 'modns' | 'unknown';
  /** True ⇒ the client shows only {kind, principal, at}. */
  opaque: boolean;
}

/** Classify a kind against this package's registry (§9.1 kind registry). */
export function kindClass(kind: string): EventRow['class'] {
  if (EVENT_KINDS[kind]) return 'registered';
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

/** A count as every Gnomon surface shows it (§9.1 G-HON-03): `{n, of}` ⇒ "n of of"; a bare count is refused. */
export function renderDenominator(v: unknown): string {
  if (typeof v !== 'object' || v === null || typeof (v as { n?: unknown }).n !== 'number' || typeof (v as { of?: unknown }).of !== 'number') {
    throw new TypeError('gnomon-contracts: a number is shown as {n, of} (G-HON-03); got a bare value');
  }
  const { n, of } = v as { n: number; of: number };
  return `${n} of ${of}`;
}

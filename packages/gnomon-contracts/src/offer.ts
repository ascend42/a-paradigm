/**
 * offer-spec:v1 and the ```offer block (the Desk, TD-2026-10-20-812; reserved in the `8.0:TD-2026-10-20-812` move).
 *
 * A mod's playbook OFFERS are declared in its manifest under `provides.offers` (≤ OFFERS_PER_MOD_MAX), one
 * OfferSpecV1 each: what the offer is (`kind`, `title`, `summary`), when in a conversation it fits (`phase`), what it
 * takes in (`contextIn`), what it gives back (`resultOut`), how it is reached (`reach: 'mcp'`, the mod's MCP server,
 * through `handoffTool`), its neighbours (`related`) and when NOT to offer it (`restraint`). A7: an unsigned
 * third-party playbook is structured fields only, so every field is a closed token or short single-line text with no
 * control, format or line-separator character.
 *
 * The MODEL proposes an offer by ending its reply with ONE fenced block:
 *
 *   ```offer
 *   {"mod": "constellation", "kind": "map-the-idea", "question": "Want me to map this on the Constellation board?"}
 *   ```
 *
 * `offerBlockOf(text)` is the ONE parser, shared by the kernel (which writes offer.shown) and the GUI (which hides the
 * block from the rendered reply). It is strict and bounded: the body is strict JSON (no YAML), at most
 * OFFER_BLOCK_MAX characters, closed keys; the fence lines are compared as strings (no regular expression runs over
 * the reply); a fence inside another code fence is ignored; two offer blocks, an unclosed block or a reply over
 * OFFER_TEXT_MAX ⇒ null (no offer, the text renders as is). The `question` is MODEL text: bounded by
 * OFFER_QUESTION_MAX code points and refused on any control/format/line-separator character.
 */

import { Checker, type ValidateOptions } from './internal.js';

export const OFFER_SPEC_V1 = 'offer-spec:v1' as const;

/** Where in a conversation an offer fits (CLOSED): widening the idea, pulling it together, or acting on it. */
export const OFFER_PHASES = ['diverge', 'synthesize', 'commit'] as const;
export type OfferPhase = (typeof OFFER_PHASES)[number];
/** What the human did with a shown offer (CLOSED). L4: `not-now` quiets that mod for the rest of the conversation. */
export const OFFER_DECISIONS = ['open', 'not-now', 'stop-here'] as const;
export type OfferDecision = (typeof OFFER_DECISIONS)[number];
/** How an offer reaches its mod (CLOSED): the mod's local MCP server (A2). */
export const OFFER_REACHES = ['mcp'] as const;

/**
 * What an offer may take in (CLOSED, Aegis review of the GUI slice): offer-spec:v1 `contextIn` and offer.shown
 * `contextIn` (the kernel copies it from the manifest spec, so the GUI's "takes:" line is kernel-written).
 */
export const CONTEXT_SOURCES = ['recent-messages', 'open-files', 'repo-path', 'selection', 'session-summary'] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];

/** At most this many offers per mod manifest. */
export const OFFERS_PER_MOD_MAX = 6;
export const OFFER_LIMITS = Object.freeze({ title: 60, summary: 200, restraint: 200, contextIn: 8, related: 6 });
/** The model-written question of an offer (offer.shown{question}), in code points. */
export const OFFER_QUESTION_MAX = 240;
/** The body of one ```offer block, in UTF-16 code units. */
export const OFFER_BLOCK_MAX = 1024;
/** A reply longer than this (UTF-16 code units) is never scanned for an offer block. */
export const OFFER_TEXT_MAX = 262_144;

/** A kebab token (offer kinds, contextIn / resultOut / related tokens). */
export const OFFER_TOKEN_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** A mod name (the manifest NAME rule). */
export const OFFER_MOD_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
/** An MCP tool name (the handoff). */
export const OFFER_TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;
/** C0, DEL, C1, line/paragraph separators and format characters (bidi controls, zero-widths, tags). */
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\p{Zl}\p{Zp}\p{Cf}]/u;

/**
 * THE offer text rule, shared by the kernel and the GUI: a non-empty single-line text of at most `max` code points with
 * no control, format or line/paragraph-separator character and no edge whitespace.
 */
export function isOfferText(v: unknown, max: number): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max * 2) return false;
  if (UNSAFE_TEXT.test(v) || v.trim() !== v) return false;
  return Array.from(v).length <= max;
}

/** The offer question rule (offer.shown{question} and the ```offer block): isOfferText at OFFER_QUESTION_MAX. */
export function isOfferQuestion(v: unknown): v is string {
  return isOfferText(v, OFFER_QUESTION_MAX);
}

/** A contextIn list: an array of at most OFFER_LIMITS.contextIn distinct CONTEXT_SOURCES. Returns errors. */
export function contextInProblems(v: unknown, path = 'contextIn'): string[] {
  const c = new Checker('strict');
  if (!c.arr(path, v)) return c.errors;
  if (v.length > OFFER_LIMITS.contextIn) c.fail(path, `at most ${OFFER_LIMITS.contextIn} entries`);
  const seen = new Set<unknown>();
  v.forEach((t, i) => {
    c.closedEnum(`${path}[${i}]`, t, CONTEXT_SOURCES);
    if (seen.has(t)) c.fail(`${path}[${i}]`, 'duplicate');
    seen.add(t);
  });
  return c.errors;
}

export interface OfferSpecV1 {
  kind: string;
  phase: OfferPhase;
  title: string;
  summary: string;
  contextIn: ContextSource[];
  resultOut: string;
  reach: 'mcp';
  handoffTool: string;
  related: string[];
  restraint: string;
}

export const OFFER_SPEC_V1_KEYS = ['kind', 'phase', 'title', 'summary', 'contextIn', 'resultOut', 'reach', 'handoffTool', 'related', 'restraint'] as const;

function tokens(c: Checker, path: string, v: unknown, max: number): void {
  if (!c.arr(path, v)) return;
  if (v.length > max) c.fail(path, `at most ${max} entries`);
  const seen = new Set<unknown>();
  v.forEach((t, i) => {
    c.str(`${path}[${i}]`, t, OFFER_TOKEN_PATTERN, 'a kebab token (≤ 64)');
    if (seen.has(t)) c.fail(`${path}[${i}]`, 'duplicate');
    seen.add(t);
  });
}

function text(c: Checker, path: string, v: unknown, max: number): void {
  if (!isOfferText(v, max)) c.fail(path, `must be single-line text of 1..${max} code points, no control, format or separator character, no edge whitespace`);
}

/** Validate one OfferSpecV1 (always strict: offers are producer-side manifest data). Returns errors; [] = valid. */
export function validateOfferSpecV1(value: unknown, _opts: ValidateOptions = {}): string[] {
  const c = new Checker('strict');
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, OFFER_SPEC_V1_KEYS);
  c.required('', v, OFFER_SPEC_V1_KEYS);
  if ('kind' in v) c.str('kind', v.kind, OFFER_TOKEN_PATTERN, 'a kebab token (≤ 64)');
  if ('phase' in v) c.closedEnum('phase', v.phase, OFFER_PHASES);
  if ('title' in v) text(c, 'title', v.title, OFFER_LIMITS.title);
  if ('summary' in v) text(c, 'summary', v.summary, OFFER_LIMITS.summary);
  if ('contextIn' in v) for (const e of contextInProblems(v.contextIn)) c.errors.push(e);
  if ('resultOut' in v) c.str('resultOut', v.resultOut, OFFER_TOKEN_PATTERN, 'a kebab token (≤ 64)');
  if ('reach' in v) c.closedEnum('reach', v.reach, OFFER_REACHES);
  if ('handoffTool' in v) c.str('handoffTool', v.handoffTool, OFFER_TOOL_PATTERN, 'an MCP tool name');
  if ('related' in v) tokens(c, 'related', v.related, OFFER_LIMITS.related);
  if ('restraint' in v) text(c, 'restraint', v.restraint, OFFER_LIMITS.restraint);
  return c.errors;
}

export function isOfferSpecV1(value: unknown): value is OfferSpecV1 {
  return validateOfferSpecV1(value).length === 0;
}

/* ── the ```offer block ──────────────────────────────────────────────────── */

/** What a model's ```offer block names: the mod, the offer kind, and the one question shown to the human. */
export interface OfferBlockV1 {
  mod: string;
  kind: string;
  question: string;
}
export const OFFER_BLOCK_KEYS = ['mod', 'kind', 'question'] as const;

export interface OfferBlockResult {
  offer: OfferBlockV1;
  /** the reply without the block (what the GUI renders) */
  body: string;
}

/** Validate a parsed block body. Returns errors; [] = valid. */
export function validateOfferBlock(value: unknown): string[] {
  const c = new Checker('strict');
  if (!c.obj('', value)) return c.errors;
  c.closed('', value, OFFER_BLOCK_KEYS);
  c.required('', value, OFFER_BLOCK_KEYS);
  if ('mod' in value) c.str('mod', value.mod, OFFER_MOD_PATTERN, 'a mod name');
  if ('kind' in value) c.str('kind', value.kind, OFFER_TOKEN_PATTERN, 'a kebab token (≤ 64)');
  if ('question' in value && !isOfferQuestion(value.question)) c.fail('question', `must be single-line text of 1..${OFFER_QUESTION_MAX} code points, no control, format or separator character, no edge whitespace`);
  return c.errors;
}

const FENCE = '```';
const OPEN_FENCE = '```offer';

/** Trailing spaces and tabs only (a fence line may carry them); no regular expression. */
function trimTrail(s: string): string {
  let e = s.length;
  while (e > 0 && (s.charCodeAt(e - 1) === 0x20 || s.charCodeAt(e - 1) === 0x09)) e--;
  return s.slice(0, e);
}

/** The run of `ch` (backtick or tilde) that starts the line, as a count. */
function runOf(line: string, ch: number): number {
  let n = 0;
  while (n < line.length && line.charCodeAt(n) === ch) n++;
  return n;
}

const BACKTICK = 0x60;
const TILDE = 0x7e;

/**
 * The ONE ```offer block of a reply, or null. Strict and linear: lines are scanned once and fence lines compared as
 * strings or by counting a run of backticks/tildes; a fence must start the line (no indent). Inside another fenced
 * block (``` or ~~~, closed CommonMark-style by a bare run of the same character at least as long) nothing is an
 * offer. Null when: the reply is not a string or is over OFFER_TEXT_MAX; there is no block; there are two or more;
 * the block is unclosed or its body is over OFFER_BLOCK_MAX; the body is not strict JSON; or it fails
 * validateOfferBlock.
 */
export function offerBlockOf(text: unknown): OfferBlockResult | null {
  if (typeof text !== 'string' || text.length > OFFER_TEXT_MAX) return null;
  const lines = text.split('\n');
  const at = (i: number): string => trimTrail(lines[i]!.endsWith('\r') ? lines[i]!.slice(0, -1) : lines[i]!);
  let other: { ch: number; n: number } | null = null;
  let found: { start: number; end: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = at(i);
    if (other) {
      const n = runOf(line, other.ch);
      if (n >= other.n && n === line.length) other = null;
      continue;
    }
    if (line === OPEN_FENCE) {
      if (found) return null; // two blocks: ambiguous, no offer
      let j = i + 1;
      let size = 0;
      while (j < lines.length && at(j) !== FENCE) {
        size += lines[j]!.length + 1;
        if (size > OFFER_BLOCK_MAX) return null;
        j++;
      }
      if (j >= lines.length) return null; // unclosed
      found = { start: i, end: j };
      i = j;
      continue;
    }
    for (const ch of [BACKTICK, TILDE]) {
      const n = runOf(line, ch);
      if (n >= 3) {
        other = { ch, n };
        break;
      }
    }
  }
  if (!found) return null;
  const raw = lines.slice(found.start + 1, found.end).join('\n');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (validateOfferBlock(parsed).length) return null;
  const p = parsed as Record<string, string>;
  const body = [...lines.slice(0, found.start), ...lines.slice(found.end + 1)].join('\n').trimEnd();
  return { offer: { mod: p.mod!, kind: p.kind!, question: p.question! }, body };
}

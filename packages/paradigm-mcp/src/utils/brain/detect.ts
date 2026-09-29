/**
 * #brain-detect — local detectors, run BEFORE anything is persisted.
 *
 * Secret / ID detectors → file 'quarantined'. Chat-export shapes → 'third-party-data'.
 * Returns detector IDs only — the matched text never leaves this module.
 *
 * ReDoS hardening (Aegis 7.14.0):
 *   - Every regex is linear: no nested quantifiers, no unbounded lazy spans.
 *     `secret-assignment` is a hand-written scanner (separator → key token →
 *     value), not a regex.
 *   - Secrets are scanned per line; each line is cut into DETECT_WINDOW-char
 *     windows (with a small overlap so a token straddling a cut is still seen),
 *     so no single regex ever runs over more than DETECT_WINDOW characters.
 *   - A pre-emptive time budget: callers pass `budgetMs`; once elapsed time
 *     exceeds it detection throws DetectorTimeoutError, which the scanner turns
 *     into a 'detector-timeout' quarantine (fail closed).
 */
import * as path from 'node:path';
import type { DetectResult, DetectorId } from './types.js';

/** Max characters any single detector regex sees at once. */
export const DETECT_WINDOW = 4096;
/** Runs of 2+ horizontal whitespace chars (collapsed to one space before windowing). */
const WS_RUN_RE = /[ \t\f\v\u00a0]{2,}/g;
/** Overlap between consecutive windows of one long line. */
const WINDOW_OVERLAP = 256;

export class DetectorTimeoutError extends Error {
  constructor() {
    super('detector budget exceeded');
    this.name = 'DetectorTimeoutError';
  }
}

/** Pre-emptive budget: `check()` throws once the deadline has passed. */
class Budget {
  private readonly deadline: number;
  private n = 0;
  constructor(budgetMs: number | undefined) {
    this.deadline = budgetMs && budgetMs > 0 ? performance.now() + budgetMs : Infinity;
  }
  /** Cheap: only reads the clock every 16 calls. */
  check(): void {
    if (this.deadline === Infinity) return;
    if ((++this.n & 15) !== 0) return;
    if (performance.now() > this.deadline) throw new DetectorTimeoutError();
  }
  force(): void {
    if (this.deadline !== Infinity && performance.now() > this.deadline) throw new DetectorTimeoutError();
  }
}

/** Single-token detectors — all linear (bounded or disjoint character classes only). */
const SECRET_PATTERNS: Array<[DetectorId, RegExp]> = [
  ['pem-private-key', /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY/],
  ['aws-access-key', /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22})/],
  ['slack-token', /\bxox[abposr]-[A-Za-z0-9-]{10}/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20}/],
  ['openai-key', /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['stripe-key', /\bsk_live_[0-9A-Za-z]{16}/],
  // header.payload.signature — header is base64url JSON ('{"' → eyJ). The
  // segment class excludes '.', so each segment is matched deterministically.
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['us-ssn', /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/],
];

/** Placeholder values that should not trip the assignment detector (tested against the VALUE only). */
const PLACEHOLDER_RE = /x{4,}|\*{4,}|changeme|placeholder|your[-_]?(?:api[-_]?)?key|example|redacted|<[^>]{0,200}>|\$\{[^}]{0,200}\}/i;

// ── secret-assignment (hand-written scanner) ─────────────────────────

/** Anchored, non-nested key-token shape. */
const KEY_TOKEN_RE = /^[A-Za-z0-9_.-]{1,64}$/;
/** Key segments (split on _ . - and camelCase) that make a key sensitive. */
const SECRET_KEYWORDS = [
  'key', 'apikey', 'accesskey', 'privatekey', 'secretkey',
  'secret', 'clientsecret',
  'token', 'authtoken',
  'password', 'passwd', 'passphrase', 'pwd',
];
const MIN_VALUE = 8;
const MAX_VALUE = 128;

const isKeyChar = (c: number): boolean =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 45;
/** Chars that may precede a key token (start of line, whitespace, quote, `{`, `,`). */
const isKeyBoundary = (c: number): boolean => c === 32 || c === 9 || c === 34 || c === 39 || c === 123 || c === 44 || c === 13;
/** Chars that end a value. */
const isValueEnd = (c: number): boolean => c === 32 || c === 9 || c === 13 || c === 10 || c === 34 || c === 39 || c === 60 || c === 62;

export function keyIsSensitive(key: string): boolean {
  if (!KEY_TOKEN_RE.test(key)) return false;
  // camelCase → segments, then split on _ . -
  const segs = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[_.-]/);
  return segs.some((s) => SECRET_KEYWORDS.includes(s));
}

/** One line (window) → true when it holds a non-placeholder `key: value` / `key=value`. */
function hasAssignment(line: string): boolean {
  let prevSep = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 58 /* : */ && c !== 61 /* = */) continue;
    const sep = i;
    const lower = prevSep;
    prevSep = sep;
    // ── key token before the separator: [ \t]* then optional quote, then key chars
    let j = sep - 1;
    while (j > lower && (line.charCodeAt(j) === 32 || line.charCodeAt(j) === 9)) j--;
    if (j > lower && (line.charCodeAt(j) === 34 || line.charCodeAt(j) === 39)) j--;
    const keyEnd = j + 1;
    let k = j;
    while (k > lower && keyEnd - k <= 65 && isKeyChar(line.charCodeAt(k))) k--;
    const keyStart = k + 1;
    if (keyEnd - keyStart < 1 || keyEnd - keyStart > 64) continue;
    if (k >= 0 && k !== lower && !isKeyBoundary(line.charCodeAt(k))) continue;
    if (k >= 0 && k === lower) continue; // key glued to a previous separator (e.g. `a=key=v`)
    if (!keyIsSensitive(line.slice(keyStart, keyEnd))) continue;
    // ── value after the separator: [ \t]* then optional quote, then ≥8 non-space chars
    let v = sep + 1;
    while (v < line.length && (line.charCodeAt(v) === 32 || line.charCodeAt(v) === 9)) v++;
    if (v < line.length && (line.charCodeAt(v) === 34 || line.charCodeAt(v) === 39)) v++;
    let e = v;
    while (e < line.length && e - v < MAX_VALUE && !isValueEnd(line.charCodeAt(e))) e++;
    if (e - v < MIN_VALUE) continue;
    if (PLACEHOLDER_RE.test(line.slice(v, e))) continue;
    return true;
  }
  return false;
}

// ── card numbers (hand-written scanner, Luhn) ────────────────────────

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isWordChar = (c: number): boolean => isDigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

function cardCandidateValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  const first = digits.charCodeAt(0);
  if (first < 51 || first > 54) return false; // 3-6
  if (/^(\d)\1+$/.test(digits)) return false;
  return luhnValid(digits);
}

/** Runs of digits with at most one ' ' / '-' between digits, word-bounded. */
function hasCard(line: string): boolean {
  let i = 0;
  while (i < line.length) {
    const c = line.charCodeAt(i);
    if (!isDigit(c) || (i > 0 && isWordChar(line.charCodeAt(i - 1)))) { i++; continue; }
    let digits = '';
    let j = i;
    while (j < line.length && digits.length <= 19) {
      const cj = line.charCodeAt(j);
      if (isDigit(cj)) { digits += line[j]; j++; continue; }
      if ((cj === 32 || cj === 45) && j + 1 < line.length && isDigit(line.charCodeAt(j + 1))) { j++; continue; }
      break;
    }
    const bounded = j >= line.length || !isWordChar(line.charCodeAt(j));
    if (bounded && cardCandidateValid(digits)) return true;
    i = j > i ? j : i + 1;
  }
  return false;
}

// ── IBAN (country length table + mod-97) ─────────────────────────────

const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28,
  CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18,
  FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22,
  IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20,
  LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15,
  PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19,
  SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};
/** Candidate: CC + 2 check digits + up to 30 alnum, single optional spaces (disjoint classes → linear). */
const IBAN_CANDIDATE_RE = /\b[A-Z]{2}[0-9]{2}(?: ?[A-Z0-9]){11,30}/g;

export function ibanValid(iban: string): boolean {
  const len = IBAN_LENGTHS[iban.slice(0, 2)];
  if (!len || iban.length !== len) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let rem = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const c = rearranged.charCodeAt(i);
    const v = c >= 65 && c <= 90 ? String(c - 55) : rearranged[i];
    for (let k = 0; k < v.length; k++) rem = (rem * 10 + (v.charCodeAt(k) - 48)) % 97;
  }
  return rem === 1;
}

function hasIban(line: string): boolean {
  IBAN_CANDIDATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IBAN_CANDIDATE_RE.exec(line))) {
    const compact = m[0].replace(/ /g, '');
    const len = IBAN_LENGTHS[compact.slice(0, 2)];
    if (len && compact.length >= len && ibanValid(compact.slice(0, len))) return true;
  }
  return false;
}

// ── MRZ ──────────────────────────────────────────────────────────────

const MRZ_LINE_RE = /^[A-Z0-9<]{30}$|^[A-Z0-9<]{36}$|^[A-Z0-9<]{44}$/;

function hasMrz(lines: string[], budget: Budget): boolean {
  for (let i = 0; i < lines.length; i++) {
    budget.check();
    const raw = lines[i];
    if (raw.length > 64) continue;
    const l = raw.trim();
    if (!MRZ_LINE_RE.test(l) || !l.includes('<<')) continue;
    const next = (lines[i + 1] ?? '').slice(0, 64).trim();
    // Passport TD3 line 1 or any two consecutive MRZ-shaped lines.
    if (/^P[A-Z<]/.test(l) || /^[AIC][A-Z<]/.test(l) || (MRZ_LINE_RE.test(next) && next.length === l.length)) return true;
  }
  return false;
}

// ── line windows ─────────────────────────────────────────────────────

function* windows(line: string): Generator<string> {
  if (line.length <= DETECT_WINDOW) { yield line; return; }
  const step = DETECT_WINDOW - WINDOW_OVERLAP;
  for (let s = 0; s < line.length; s += step) {
    yield line.slice(s, s + DETECT_WINDOW);
    if (s + DETECT_WINDOW >= line.length) return;
  }
}

export interface DetectOptions {
  /** Pre-emptive budget in ms (0/undefined = unlimited). Exceeding it throws DetectorTimeoutError. */
  budgetMs?: number;
}

function scanSecrets(lines: string[], budget: Budget): DetectorId[] {
  const hits = new Set<DetectorId>();
  for (const raw of lines) {
    budget.check();
    // Collapse whitespace runs first so padding cannot push a value into the
    // next window away from its key (linear: single-class quantifier).
    const line = raw.length > 64 ? raw.replace(WS_RUN_RE, ' ') : raw;
    for (const w of windows(line)) {
      budget.check();
      for (const [id, re] of SECRET_PATTERNS) if (!hits.has(id) && re.test(w)) hits.add(id);
      if (!hits.has('secret-assignment') && hasAssignment(w)) hits.add('secret-assignment');
      if (!hits.has('card-number') && hasCard(w)) hits.add('card-number');
      if (!hits.has('iban') && hasIban(w)) hits.add('iban');
    }
  }
  if (hasMrz(lines, budget)) hits.add('passport-mrz');
  budget.force();
  return [...hits];
}

export function detectSecrets(text: string, opts: DetectOptions = {}): DetectorId[] {
  const budget = new Budget(opts.budgetMs);
  return scanSecrets(text.split('\n'), budget);
}

// ── third-party (chat export) shapes ─────────────────────────────────

const CHAT_NAME_RE = /(?:^|\/)(?:messages?\.json|message_\d+\.(?:json|html)|_chat\.txt|whatsapp chat with [^/]{0,200}\.txt)$/i;
const WHATSAPP_LINE_RE = /^\[?\d{1,2}[/.]\d{1,2}[/.]\d{2,4},? \d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?\]? (?:- )?[^:\n]{1,60}: /;
const DISCORD_CSV_RE = /^AuthorID,Author,Date,Content/m;
const SLACK_TS_RE = /"ts"\s{0,8}:\s{0,8}"\d{1,20}\.\d{1,20}"/g;
const SLACK_USER_RE = /"(?:user|user_profile)"\s{0,8}:/;
const DISCORD_AUTHOR_RE = /"author"\s{0,8}:/g;
const DISCORD_CONTENT_RE = /"content"\s{0,8}:/;
const DISCORD_TS_RE = /"timestamp"\s{0,8}:/;
/** Max anchor occurrences examined per shape (bounds work on adversarial input). */
const MAX_ANCHORS = 64;
const NEAR = 400;

function slackShape(text: string, budget: Budget): boolean {
  SLACK_TS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = SLACK_TS_RE.exec(text)) && n++ < MAX_ANCHORS) {
    budget.check();
    const lo = Math.max(0, m.index - NEAR);
    if (SLACK_USER_RE.test(text.slice(lo, m.index + m[0].length + NEAR))) return true;
  }
  return false;
}

function discordShape(text: string, budget: Budget): boolean {
  DISCORD_AUTHOR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = DISCORD_AUTHOR_RE.exec(text)) && n++ < MAX_ANCHORS) {
    budget.check();
    const after = text.slice(m.index, m.index + 2 * NEAR + 64);
    const c = DISCORD_CONTENT_RE.exec(after);
    if (c && DISCORD_TS_RE.test(after.slice(c.index))) return true;
    if (DISCORD_TS_RE.test(text.slice(Math.max(0, m.index - NEAR), m.index))) return true;
  }
  return false;
}

function thirdPartyText(text: string, budget: Budget): boolean {
  if (DISCORD_CSV_RE.test(text.slice(0, 4096))) return true;
  if (slackShape(text, budget) || discordShape(text, budget)) return true;
  // WhatsApp: ≥3 timestamped "Name: msg" lines
  let n = 0;
  for (const line of text.split('\n')) {
    budget.check();
    if (line.length < 12) continue;
    if (WHATSAPP_LINE_RE.test(line.slice(0, 256)) && ++n >= 3) return true;
  }
  return false;
}

export function detectThirdParty(relpath: string, text: string | null, opts: DetectOptions = {}): boolean {
  if (CHAT_NAME_RE.test(relpath)) return true;
  if (text == null) return false;
  return thirdPartyText(text, new Budget(opts.budgetMs));
}

/** Extensions read for DETECTION ONLY (never parsed/persisted beyond path/size/type). */
export const DETECT_ONLY_EXTS = new Set(['.json', '.csv', '.env', '.yaml', '.yml', '.log', '.ini', '.conf', '.cfg', '.toml', '.html', '.htm', '.xml', '.pem', '.key']);

export function shouldReadForDetection(relpath: string, ext: string): boolean {
  const base = path.posix.basename(relpath).toLowerCase();
  return DETECT_ONLY_EXTS.has(ext) || base.startsWith('.env') || base === 'credentials' || base === 'id_rsa' || base === 'id_ed25519';
}

/**
 * Run every detector under ONE shared budget. Throws DetectorTimeoutError once
 * `budgetMs` has elapsed — callers must quarantine (fail closed).
 */
export function detect(relpath: string, text: string | null, opts: DetectOptions = {}): DetectResult {
  const budget = new Budget(opts.budgetMs);
  if (text == null) return { secrets: [], thirdParty: CHAT_NAME_RE.test(relpath) };
  const secrets = scanSecrets(text.split('\n'), budget);
  const thirdParty = CHAT_NAME_RE.test(relpath) || thirdPartyText(text, budget);
  budget.force();
  return { secrets, thirdParty };
}

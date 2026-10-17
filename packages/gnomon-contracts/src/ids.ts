/**
 * Ids (spec §4.2, §3.1 data model, §3.9 "ids that cross a link").
 *
 * - ULID: 48-bit ms time + 80 random bits, Crockford base32, 26 chars. Random
 *   bytes come from `globalThis.crypto.getRandomValues` (Node ≥ 19, browsers,
 *   WebViews) — never `node:crypto`, so the package stays platform-neutral.
 * - Every id that can cross a link is a ULID or log-qualified (S32-13): connId,
 *   cardId, permitId, armId, briefId, msgId, plus ev/log ids.
 * - hsid:v1:<ULID> kernel-issued; hsid:v1d:<26 base32> derived for interactive
 *   Claude Code sessions (keyed on the namespaced principalId, Q7).
 * - hsid-short = lowercase base32 of the ULID's 80 random bits (16 chars),
 *   never its time bits (A31-10). Defined for hsid:v1 only.
 * - turn ids `turn:<hsid>/<n>`, n from 1, monotonic per hsid, kernel-local.
 */

import { CROCKFORD, crockford, sha256, hex, utf8 } from './internal.js';

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const ULID_SRC = '[0-7][0-9A-HJKMNP-TV-Z]{25}';
const B32_26 = '[0-9A-HJKMNP-TV-Z]{26}';

export const ULID_MAX_TIME = 2 ** 48 - 1;

export type RandomSource = (n: number) => Uint8Array;
export type Clock = () => number;

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** Default random source: WebCrypto's `getRandomValues` on globalThis. */
export const defaultRandom: RandomSource = (n) => {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('gnomon-contracts: globalThis.crypto.getRandomValues is unavailable');
  }
  return c.getRandomValues(new Uint8Array(n));
};

function encodeTime(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > ULID_MAX_TIME) {
    throw new RangeError(`ULID time out of range: ${ms}`);
  }
  let out = '';
  let t = ms;
  for (let i = 0; i < 10; i++) {
    out = CROCKFORD[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

/** 80 random bits → exactly 16 Crockford chars (80 = 16 × 5, no padding). */
function encodeRandom(bytes: Uint8Array): string {
  if (bytes.length !== 10) throw new RangeError('ULID random part must be 10 bytes');
  return crockford(bytes);
}

export interface UlidOptions {
  random?: RandomSource;
  clock?: Clock;
}

/** One non-monotonic ULID (fresh 80 random bits every call). */
export function ulid(opts: UlidOptions = {}): string {
  const now = (opts.clock ?? Date.now)();
  return encodeTime(now) + encodeRandom((opts.random ?? defaultRandom)(10));
}

/**
 * Monotonic ULID factory: within one millisecond (or if the clock steps
 * back) the previous random part is incremented by one, so ids sort in mint
 * order — the property the log's ids rely on (L4). Overflow of the 80-bit
 * random part within one ms throws rather than wrapping.
 */
export function monotonicUlidFactory(opts: UlidOptions = {}): () => string {
  const random = opts.random ?? defaultRandom;
  const clock = opts.clock ?? Date.now;
  let lastTime = -1;
  let last = new Uint8Array(10);
  return () => {
    const now = clock();
    if (now > lastTime) {
      lastTime = now;
      last = Uint8Array.from(random(10));
    } else {
      let i = 9;
      while (i >= 0 && last[i] === 0xff) {
        last[i] = 0;
        i--;
      }
      if (i < 0) throw new RangeError('ULID random part overflow within one millisecond');
      last[i] = last[i]! + 1;
    }
    return encodeTime(lastTime) + encodeRandom(last);
  };
}

export function isUlid(v: unknown): v is string {
  return typeof v === 'string' && ULID_PATTERN.test(v);
}

/** Milliseconds since the epoch encoded in a ULID. */
export function ulidTime(id: string): number {
  if (!isUlid(id)) throw new TypeError(`not a ULID: ${id}`);
  let t = 0;
  for (let i = 0; i < 10; i++) t = t * 32 + CROCKFORD.indexOf(id[i]!);
  return t;
}

/* ── prefixed ids ─────────────────────────────────────────────────────────── */

/**
 * Prefix per ULID-backed id kind. `permit` follows §4.8 (`permit:v1:<ulid>`);
 * the others follow the event example (`ev:…`, `log:…`, `conn:…`) and the ref
 * schemes (`card:`). `brief`/`msg` are reserved for §3.9 (M1.1).
 */
export const ID_PREFIXES = {
  ev: 'ev:',
  log: 'log:',
  conn: 'conn:',
  card: 'card:',
  arm: 'arm:',
  permit: 'permit:v1:',
  brief: 'brief:',
  msg: 'msg:',
  ds: 'ds:',
} as const;
export type IdKind = keyof typeof ID_PREFIXES;

export const ID_PATTERNS: Record<IdKind, RegExp> = Object.fromEntries(
  Object.entries(ID_PREFIXES).map(([k, p]) => [k, new RegExp(`^${p}${ULID_SRC}$`)]),
) as Record<IdKind, RegExp>;

export function mintId(kind: IdKind, ulidValue: string = ulid()): string {
  if (!isUlid(ulidValue)) throw new TypeError(`not a ULID: ${ulidValue}`);
  return ID_PREFIXES[kind] + ulidValue;
}

export function isId(kind: IdKind, v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERNS[kind].test(v);
}

/** The ULID inside a prefixed id, or undefined. */
export function ulidOf(kind: IdKind, id: string): string | undefined {
  return isId(kind, id) ? id.slice(ID_PREFIXES[kind].length) : undefined;
}

/* ── hsid ─────────────────────────────────────────────────────────────────── */

export const HSID_V1_PATTERN = new RegExp(`^hsid:v1:${ULID_SRC}$`);
export const HSID_V1D_PATTERN = new RegExp(`^hsid:v1d:${B32_26}$`);
export const HSID_PATTERN = new RegExp(`^hsid:(v1:${ULID_SRC}|v1d:${B32_26})$`);

export function isHsid(v: unknown): v is string {
  return typeof v === 'string' && HSID_PATTERN.test(v);
}

/**
 * Mint a kernel-issued hsid. Uses a NON-monotonic ULID on purpose: hsid-short is
 * the ULID's 80 random bits, and a monotonic increment would make two sessions
 * opened in the same millisecond differ in one character (predictable
 * neighbours). Hsids need no intra-ms ordering; event ids do.
 */
export function mintHsid(opts: UlidOptions = {}): string {
  return `hsid:v1:${ulid(opts)}`;
}

/**
 * `hsid:v1d:<base32(sha256("gnomon:hsid:v1d\n" + principalId + "\n" + "cc:" + uuid))[0..26]>`
 * (§4.2). base32 = Crockford upper-case, the ULID alphabet, so a v1d hsid has
 * the same length and alphabet as a v1 one.
 */
export function deriveHsidV1d(principalId: string, ccSessionUuid: string): string {
  const digest = sha256(utf8(`gnomon:hsid:v1d\n${principalId}\ncc:${ccSessionUuid}`));
  return `hsid:v1d:${crockford(digest).slice(0, 26)}`;
}

export const HSID_SHORT_PATTERN = /^[0-9a-hjkmnp-tv-z]{16}$/;

/**
 * hsid-short (§4.2, A31-10): lowercase base32 of the ULID's 80 random bits, 16
 * chars — the ULID's last 16 characters, lower-cased. Only kernel-issued
 * (hsid:v1) sessions get branches/worktrees, so a derived hsid:v1d has none and
 * this throws. Uniqueness against live and past branches is checked by the
 * kernel at spawn.
 */
export function hsidShort(hsid: string): string {
  if (!HSID_V1_PATTERN.test(hsid)) throw new TypeError(`hsid-short needs an hsid:v1: ${hsid}`);
  return hsid.slice('hsid:v1:'.length + 10).toLowerCase();
}

/* ── turn ids ─────────────────────────────────────────────────────────────── */

export const TURN_ID_PATTERN = new RegExp(`^turn:(hsid:(?:v1:${ULID_SRC}|v1d:${B32_26}))/([1-9][0-9]*)$`);

export function turnId(hsid: string, n: number): string {
  if (!isHsid(hsid)) throw new TypeError(`not an hsid: ${hsid}`);
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('turn n starts at 1');
  return `turn:${hsid}/${n}`;
}

export function parseTurnId(id: string): { hsid: string; n: number } | undefined {
  const m = TURN_ID_PATTERN.exec(id);
  return m ? { hsid: m[1]!, n: Number(m[2]) } : undefined;
}

/* ── key, device, repo, contract ids ──────────────────────────────────────── */

/** keyId forms (§3.1): Ed25519 `gkey:v1`, hardware P-256 `gkey-p256:v1`, link X25519 `gkey-x25519:v1`. */
export const KEY_ID_PATTERN = /^(gkey|gkey-p256|gkey-x25519):v1:[0-9a-f]{64}$/;
export const ROOT_KEY_ID_PATTERN = /^gkey-p256:v1:[0-9a-f]{64}$/;
export const REPO_SCOPE_PATTERN = /^repo:[0-9a-f]{16}$/;
export const CONTRACT_ID_PATTERN = /^contract:v1:[0-9a-f]{64}$/;

export function isKeyId(v: unknown): v is string {
  return typeof v === 'string' && KEY_ID_PATTERN.test(v);
}

/** First 8 hex chars of a keyId's digest — the `@<rootKeyId8>` display suffix. */
export function keyId8(keyId: string): string {
  if (!isKeyId(keyId)) throw new TypeError(`not a keyId: ${keyId}`);
  return keyId.slice(keyId.lastIndexOf(':') + 1, keyId.lastIndexOf(':') + 9);
}

/** `repo:<sha256(repoId)[0..16]>` (event:v1 scope.repo, A23-1). */
export function repoScope(repoId: string): string {
  return `repo:${hex(sha256(repoId)).slice(0, 16)}`;
}

/**
 * Internal zero-dependency helpers shared by the contract modules: plain-object
 * checks, a UTF-8 encoder, a pure SHA-256, Crockford base32 and the canonical
 * JSON serializer used for content ids (clientApiId, kitId).
 *
 * Platform-neutral on purpose: no `node:*`, no DOM types, no globals beyond
 * `globalThis.crypto.getRandomValues` (read in ids.ts). The kernel bundles this
 * package (fence test, packages/gnomon/test/fence.test.ts), so it must import
 * nothing at all.
 */

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validation mode. `strict` = producer side (the kernel checking what it emits:
 * every closed enum value must be known to THIS release, unknown properties are
 * refused). `tolerant` = consumer side under the compatible-additive rule
 * (spec §4.9, §12.8): enum values listed in ADDITIVE_ENUMS may be unknown and are
 * rendered opaquely; unknown properties are ignored. Structural errors (wrong
 * type, missing required field, malformed id) fail in both modes. */
export type ValidationMode = 'strict' | 'tolerant';

export interface ValidateOptions {
  mode?: ValidationMode;
}

/** Collects `path: message` errors. */
export class Checker {
  readonly errors: string[] = [];
  constructor(readonly mode: ValidationMode) {}

  fail(path: string, msg: string): void {
    this.errors.push(path ? `${path}: ${msg}` : msg);
  }

  /** Unknown-property check (strict only). */
  closed(path: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
    if (this.mode !== 'strict') return;
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) this.fail(path, `unknown property "${k}"`);
    }
  }

  required(path: string, obj: Record<string, unknown>, keys: readonly string[]): void {
    for (const k of keys) if (!(k in obj)) this.fail(path, `missing property "${k}"`);
  }

  str(path: string, v: unknown, re?: RegExp, what?: string): v is string {
    if (typeof v !== 'string') {
      this.fail(path, 'must be a string');
      return false;
    }
    if (re && !re.test(v)) {
      this.fail(path, `must be ${what ?? `a string matching ${re.source}`}`);
      return false;
    }
    return true;
  }

  /** Closed enum: unknown values fail in both modes. */
  closedEnum(path: string, v: unknown, values: readonly string[]): void {
    if (typeof v !== 'string' || !values.includes(v)) {
      this.fail(path, `must be one of ${values.join('|')}`);
    }
  }

  /** Additive enum (§4.9): unknown string values are tolerated in tolerant mode. */
  additiveEnum(path: string, v: unknown, values: readonly string[]): void {
    if (typeof v !== 'string' || v.length === 0) {
      this.fail(path, 'must be a non-empty string');
      return;
    }
    if (this.mode === 'strict' && !values.includes(v)) {
      this.fail(path, `must be one of ${values.join('|')} (strict)`);
    }
  }

  int(path: string, v: unknown, min: number): void {
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) {
      this.fail(path, `must be an integer >= ${min}`);
    }
  }

  bool(path: string, v: unknown): void {
    if (typeof v !== 'boolean') this.fail(path, 'must be a boolean');
  }

  arr(path: string, v: unknown): v is unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, 'must be an array');
      return false;
    }
    return true;
  }

  obj(path: string, v: unknown): v is Record<string, unknown> {
    if (!isPlainObject(v)) {
      this.fail(path, 'must be an object');
      return false;
    }
    return true;
  }
}

export const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
export const SHA256_TAGGED = /^sha256:[0-9a-f]{64}$/;

/* ── UTF-8 ─────────────────────────────────────────────────────────────────── */

export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      } else c = 0xfffd;
    } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/* ── SHA-256 (FIPS 180-4), synchronous and dependency-free ────────────────── */

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(input: Uint8Array | string): Uint8Array {
  const msg = typeof input === 'string' ? utf8(input) : input;
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const H = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = W[i - 15]!;
      const w2 = W[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      W[i] = (W[i - 16]! + s0 + W[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [H[0]!, H[1]!, H[2]!, H[3]!, H[4]!, H[5]!, H[6]!, H[7]!];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + W[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]! + a) >>> 0;
    H[1] = (H[1]! + b) >>> 0;
    H[2] = (H[2]! + c) >>> 0;
    H[3] = (H[3]! + d) >>> 0;
    H[4] = (H[4]! + e) >>> 0;
    H[5] = (H[5]! + f) >>> 0;
    H[6] = (H[6]! + g) >>> 0;
    H[7] = (H[7]! + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]!);
  return out;
}

export function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** `sha256:<hex>` of a string or bytes. */
export function sha256Tagged(input: Uint8Array | string): string {
  return `sha256:${hex(sha256(input))}`;
}

/* ── Crockford base32 (the ULID alphabet) ─────────────────────────────────── */

export const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Encode bytes MSB-first in 5-bit groups (right-padded with zero bits). */
export function crockford(bytes: Uint8Array): string {
  let out = '';
  let buf = 0;
  let bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(buf >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buf &= (1 << bits) - 1;
  }
  if (bits > 0) out += CROCKFORD[(buf << (5 - bits)) & 31];
  return out;
}

/* ── canonical JSON ───────────────────────────────────────────────────────── */

/**
 * Canonical JSON for content ids: object keys sorted by UTF-16 code unit,
 * no whitespace, `undefined` object members omitted, non-finite numbers and
 * `undefined` array members refused. Same rule set as Warpline's serializer
 * (warpline-fabric-schema-v2.md §1.2) for the value space contracts use.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((v) => {
        if (v === undefined) throw new TypeError('canonicalJson: undefined array member');
        return canonicalJson(v);
      })
      .join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
}

/** Deep-freeze a descriptor tree (frozen lists are part of the contract). */
export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v as object)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

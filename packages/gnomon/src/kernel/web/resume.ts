/**
 * @symbol #gui-resume
 *
 * #gui-resume (TD-2026-10-19-063 flow 2, founder ruling "ONE Touch ID"): the
 * `{resumeToken}` auth form that lets the GUI that ACCEPTED an upgrade card
 * reattach to the successor kernel without a second presence prompt.
 *
 *   MINT (old kernel, at the upgrade accept). Only when the accept came from a
 *     live GUI session: 32 random bytes, handed to THAT connection alone in a
 *     `gui.resume{resumeToken, ttlMs}` notification. The kernel keeps only the
 *     sha256 digest, bound to the GUI session's principal and device id and
 *     the root namespace.
 *   HAND-OFF. After the drain, just before the lock is released, the old
 *     kernel writes `<home>/gui-resume.json` (0600, tmp + rename): the DIGEST,
 *     the binding, mintedAt and expiresAt = mintedAt + RESUME_TOKEN_TTL_MS.
 *     The file never holds the token, so a reader of the home (the session
 *     sandbox already denies it) learns nothing it could present.
 *   TAKE (successor, at boot, under the lock). Read once and UNLINKED at once;
 *     refused when it is not a regular file, is group/world-readable, is
 *     malformed, names a TTL longer than RESUME_TOKEN_TTL_MS or has expired.
 *   EXCHANGE (`auth {resumeToken}` on the web endpoint, exactly one key):
 *     unknown digest ⇒ unknown-token; after expiresAt ⇒ token-expired; a
 *     second use ⇒ replayed-transcript; a binding whose device is no longer a
 *     registered HUMAN device of that principal in this root namespace ⇒
 *     unknown-token (cross-principal). Fresh ⇒ a GUI session `via:'resume'` as
 *     the bound principal. RESUME_MAX_MISSES wrong tokens burn the record.
 *
 * It authenticates a GUI connection and nothing else: it never decides a card,
 * never counts as presence and never refreshes an unlock (the broker's caches
 * are per connection; the new connection has none).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The configured TTL of a resume token, from the hand-off file's write to the successor's exchange. */
export const RESUME_TOKEN_TTL_MS = 60_000;
export const RESUME_FILE = 'gui-resume.json';
/** Wrong tokens tolerated before the record is burned (a guess never succeeds; this caps the noise). */
export const RESUME_MAX_MISSES = 8;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_SHAPE = /^[0-9a-f]{64}$/;

export interface ResumeBinding {
  principal: string;
  deviceId: string;
  /** the root namespace of the kernel that minted it (a successor on another root refuses it) */
  ns: string;
}

export interface ResumeRecord extends ResumeBinding {
  schemaVersion: 'gnomon-gui-resume:v1';
  digest: string;
  mintedAt: number;
  expiresAt: number;
}

const digestOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** A fresh resume token (base64url, 32 bytes). */
export function mintResumeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function resumeRecordOf(token: string, b: ResumeBinding, now: number, ttlMs = RESUME_TOKEN_TTL_MS): ResumeRecord {
  return { schemaVersion: 'gnomon-gui-resume:v1', digest: digestOf(token), principal: b.principal, deviceId: b.deviceId, ns: b.ns, mintedAt: now, expiresAt: now + ttlMs };
}

/** The hand-off: `<home>/gui-resume.json` at 0600, digest only. */
export function writeResumeHandoff(home: string, rec: ResumeRecord): void {
  const file = path.join(home, RESUME_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/** Read and UNLINK the hand-off at once; null when absent or refused (see the module doc). Never throws. */
export function takeResumeHandoff(home: string, now: number, platform: string = process.platform): ResumeRecord | null {
  const file = path.join(home, RESUME_FILE);
  let raw: string;
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    return null;
  }
  try {
    if (!st.isFile()) return null;
    if (platform !== 'win32' && (st.mode & 0o077) !== 0) return null;
    if (st.size > 4096) return null;
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.schemaVersion !== 'gnomon-gui-resume:v1') return null;
    if (typeof o.digest !== 'string' || !DIGEST_SHAPE.test(o.digest)) return null;
    if (typeof o.principal !== 'string' || typeof o.deviceId !== 'string' || typeof o.ns !== 'string') return null;
    if (typeof o.mintedAt !== 'number' || typeof o.expiresAt !== 'number') return null;
    if (o.expiresAt - o.mintedAt > RESUME_TOKEN_TTL_MS || o.expiresAt <= now || o.mintedAt > now + 5_000) return null;
    return { schemaVersion: 'gnomon-gui-resume:v1', digest: o.digest, principal: o.principal, deviceId: o.deviceId, ns: o.ns, mintedAt: o.mintedAt, expiresAt: o.expiresAt };
  } catch {
    return null;
  }
}

export type ResumeClass = { kind: 'unknown' } | { kind: 'expired' } | { kind: 'replay' } | { kind: 'principal' } | { kind: 'fresh'; binding: ResumeBinding };

export interface ResumeGateOptions {
  record: ResumeRecord | null;
  /** this kernel's root namespace */
  ns: string;
  /** is `deviceId` a registered human device of `principal` (registry, read at exchange time) */
  isHumanDevice: (principal: string, deviceId: string) => boolean;
  now?: () => number;
}

/** The successor's single-use resume gate. */
export class ResumeGate {
  readonly #o: ResumeGateOptions;
  #record: ResumeRecord | null;
  #used = false;
  #misses = 0;

  constructor(o: ResumeGateOptions) {
    this.#o = o;
    this.#record = o.record;
  }

  /** Is a record waiting (status; the GUI never sees it). */
  get pending(): boolean {
    return this.#record !== null && !this.#used;
  }

  exchange(token: unknown): ResumeClass {
    const rec = this.#record;
    if (!rec || typeof token !== 'string' || !TOKEN_SHAPE.test(token)) return this.#miss();
    const a = Buffer.from(digestOf(token), 'hex');
    const b = Buffer.from(rec.digest, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return this.#miss();
    if (this.#used) return { kind: 'replay' };
    this.#used = true; // single use, whatever the outcome below
    if ((this.#o.now ?? Date.now)() > rec.expiresAt) return { kind: 'expired' };
    if (rec.ns !== this.#o.ns || !this.#o.isHumanDevice(rec.principal, rec.deviceId)) return { kind: 'principal' };
    return { kind: 'fresh', binding: { principal: rec.principal, deviceId: rec.deviceId, ns: rec.ns } };
  }

  #miss(): ResumeClass {
    if (this.#record && !this.#used && ++this.#misses >= RESUME_MAX_MISSES) this.#record = null;
    return { kind: 'unknown' };
  }
}

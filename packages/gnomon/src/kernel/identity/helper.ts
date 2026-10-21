/**
 * @symbol #identity
 *
 * #identity (spec §3.1 root + approvals keys, §16 keys row, G-HLP-01; M1.3
 * slice 1) — the kernel's side of the signed helper (`packages/gnomon-helper`,
 * protocol `gnomon-helper:v2`, NDJSON over the child's stdin/stdout).
 *
 * TRUST BEFORE SPAWN. The kernel never runs a helper it has not pinned:
 *   1. the path is resolved ONCE (realpathSync.native) and must be a regular
 *      executable file;
 *   2. it must satisfy HELPER_REQUIREMENT — `codesign --verify --strict` plus
 *      the designated requirement: Apple anchor, Developer ID Application leaf
 *      under the Developer ID CA, team SW4BMQ8PNL, identifier gnomon.helper
 *      (identical to packages/gnomon-helper/scripts/signing.mjs);
 *   3. its sha256 is recorded at verification and RE-CHECKED SYNCHRONOUSLY
 *      (stat + hash) right before every spawn, so a binary swapped after
 *      verification is refused;
 *   4. G-HLP-01 (T-2026-10-21-028, #release-pins): in a RELEASE build the
 *      sha256 must also equal the one the release build compiled in
 *      for this arch (refused `checksum`): a correctly signed but different
 *      helper (an older or a tampered-then-resigned build) never runs. A dev
 *      build (no manifest) keeps steps 1-3 plus the version floor.
 * A missing, unsigned or changed helper fails closed: HelperUnavailableError
 * (the callers refuse UNSUPPORTED, never a software fallback, §3.1).
 * The window between the final file re-check and exec(2) is closed for
 * `serve` by the post-spawn pid check; a one-shot `once` child is not
 * pid-verified (residual).
 *
 * Round 2 (Aegis H1 c, H5): the pin is hash → verify → re-hash; after spawn
 * the RUNNING child is code-sign-verified by pid and must answer `info` with
 * HELPER_PROTOCOL and a version ≥ MIN_HELPER_VERSION before any request.
 * The platform check lives in src/platform/helper-verifier.ts (R6).
 *
 * The verifier is a seam only for tests on hosts with no Developer ID build:
 * `acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK)` — programmatic only, no
 * env var or flag selects it, and gnomond never constructs it.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { helperVerifierFor } from '../../platform/helper-verifier.js';
import { artifactPin, loadedReleasePins, type ReleasePins } from '../lifecycle/release-pins.js';

export const HELPER_TEAM = 'SW4BMQ8PNL';
export const HELPER_IDENTIFIER = 'gnomon.helper';
export const HELPER_PROTOCOL = 'gnomon-helper:v2'; // v2 (helper 1.6.0): voice arm ops + the unsolicited session push
/**
 * Aegis H1 (c): identifier + team is not enough (every binary the team signs
 * as gnomon.helper passes it, an old one included). After spawn and before
 * any request the kernel asks `info` and refuses a helper whose protocol is
 * not HELPER_PROTOCOL or whose version is below this floor (the floor moves
 * with every security-relevant helper change). Chosen over a CDHash
 * allowlist: a timestamped signature changes the CDHash-bearing bytes on
 * every founder build, so an allowlist shipped with the kernel would break on
 * each rebuild; the floor stops downgrades to known-weaker helpers.
 */
export const MIN_HELPER_VERSION = '1.6.0'; // 1.6.0: protocol v2, voice arms (own store), approve-voice under an arm only, lock/sleep observer push; 1.5.0: root fresh signs return `shown` (setup's helper-line check), decisionSig v2 prompt line; 1.4.0: presence.available
// was 1.3.0: // 1.3.0: T-2026-10-18-028 M2 (absolute unlock TTL + signature cap in the helper)
/** The designated requirement the helper must satisfy (Developer ID, this team, this identifier). */
export const HELPER_REQUIREMENT =
  `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${HELPER_TEAM}" and identifier "${HELPER_IDENTIFIER}"`;

/** One reply line and one request line are bounded (the helper bounds its side the same). */
export const HELPER_MAX_LINE_BYTES = 1 << 20;
/** Requests queued behind the one in flight (the helper is single-threaded; presence prompts are slow). */
export const HELPER_MAX_QUEUED = 16;
/** A presence prompt may wait on the human; everything else answers fast. */
export const HELPER_SIGN_TIMEOUT_MS = 120_000;
export const HELPER_OP_TIMEOUT_MS = 15_000;

export class HelperUnavailableError extends Error {
  constructor(
    readonly reason: 'missing' | 'not-a-file' | 'unsigned' | 'changed' | 'checksum' | 'spawn' | 'exited' | 'timeout' | 'busy' | 'protocol' | 'platform' | 'version' | 'closed',
    message: string,
  ) {
    super(`#identity: helper unavailable (${reason}): ${message}`);
    this.name = 'HelperUnavailableError';
  }
}

/** The helper answered `ok:false` (presence-denied, presence-unavailable, no-unlock, not-found, exists, domain-refused, bad-request …). */
export class HelperRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(`#identity: helper refused (${code}): ${message}`);
    this.name = 'HelperRefusal';
  }
}

export type HelperReply = Record<string, unknown>;

/**
 * Protocol v2 (helper 1.6.0, spec §14.7, S29-K5): what the helper's session observer saw. On any of
 * these the helper has ALREADY invalidated every voice arm and every cached unlock before it pushed.
 */
export const HELPER_SESSION_CAUSES = ['screen-lock', 'screensaver', 'display-sleep', 'system-sleep', 'user-switch'] as const;
export type HelperSessionCause = (typeof HELPER_SESSION_CAUSES)[number];

/** An unsolicited helper frame: `{push:'session', cause, arms[], unlocks, seq}` — never carries an `id`. */
export interface HelperPush {
  push: 'session';
  cause: HelperSessionCause;
  /** arm ids the helper closed (informational: the kernel ends EVERY arm it holds, fail closed) */
  arms: string[];
  unlocks: number;
  seq: number;
}

/** Parse a push frame strictly; null = not a well-formed push (the transport then treats the line as protocol garbage). */
export function parseHelperPush(o: Record<string, unknown>): HelperPush | null {
  if (o.push !== 'session' || 'id' in o) return null;
  if (typeof o.cause !== 'string' || !(HELPER_SESSION_CAUSES as readonly string[]).includes(o.cause)) return null;
  const arms = Array.isArray(o.arms) && o.arms.length <= 64 && o.arms.every((a) => typeof a === 'string' && a.length <= 64) ? (o.arms as string[]) : null;
  if (!arms || !Number.isSafeInteger(o.unlocks) || !Number.isSafeInteger(o.seq)) return null;
  return { push: 'session', cause: o.cause as HelperSessionCause, arms, unlocks: o.unlocks as number, seq: o.seq as number };
}

/** What the kernel talks to: one serialized request at a time. Fakes implement this in tests. */
export interface HelperTransport {
  request(req: Record<string, unknown>, timeoutMs?: number): Promise<HelperReply>;
  readonly alive: boolean;
  onExit(cb: () => void): void;
  /** Protocol v2: an unsolicited session push (lock, sleep, user switch) arrived; the helper already ended every arm and unlock. */
  onPush?(cb: (p: HelperPush) => void): void;
  close(): Promise<void>;
  /** T-2026-10-18-028 M3: a helper PROCESS is running now (a supervisor that starts on demand may have none). Default: `alive`. */
  readonly running?: boolean;
  /** T-2026-10-18-028 M3: end the current helper process (its unlocks die with it) without closing for good. Default: close(). */
  recycle?(): Promise<void>;
  /** TD-2026-10-20-514: the version the running helper's `info` handshake reported (undefined before one ran). */
  readonly version?: string;
}

/** Synchronous one-shot (`gnomon-helper once`): root signatures from synchronous callers (the CLI). */
export type HelperOnceSync = (req: Record<string, unknown>, timeoutMs?: number) => HelperReply;

/* ── pinning ───────────────────────────────────────────────────────────── */

export const DEV_TEST_HELPER_ACK = 'gnomon-dev-test-helper:unsigned:never-production' as const;

export interface HelperVerifier {
  /** Throws HelperUnavailableError when `exe` is not the signed helper. */
  verify(exe: string): void;
  /** After spawn, before the first request: throws when the RUNNING child is not the signed helper (H5). */
  verifyRunning(pid: number): void;
  readonly kind: 'codesign' | 'dev-test' | 'unavailable';
}

/** Production: the platform backend's code-signing check against HELPER_REQUIREMENT (platform/helper-verifier.ts). */
export function productionHelperVerifier(platform: string = process.platform): HelperVerifier {
  const v = helperVerifierFor(platform);
  return Object.freeze({
    kind: v.kind === 'codesign' ? ('codesign' as const) : ('unavailable' as const),
    verify(exe: string): void {
      if (v.kind !== 'codesign') throw new HelperUnavailableError('platform', `this platform ${v.why}`);
      if (!v.verifyFile(exe, HELPER_REQUIREMENT)) throw new HelperUnavailableError('unsigned', `${exe} ${v.why} (team ${HELPER_TEAM}, ${HELPER_IDENTIFIER})`);
    },
    verifyRunning(pid: number): void {
      if (v.verifyPid(pid, HELPER_REQUIREMENT) !== true) throw new HelperUnavailableError('unsigned', `the running helper (pid ${pid}) ${v.why}`);
    },
  });
}

/** The production verifier for this host. */
export const CODESIGN_VERIFIER: HelperVerifier = productionHelperVerifier();

/** Tests only: accept any executable (programmatic acknowledgement; never env/argv). */
export function acceptUnsignedHelperForTests(ack: typeof DEV_TEST_HELPER_ACK): HelperVerifier {
  if (ack !== DEV_TEST_HELPER_ACK) throw new Error('#identity: the unsigned-helper verifier needs DEV_TEST_HELPER_ACK');
  return Object.freeze({ kind: 'dev-test' as const, verify: () => undefined, verifyRunning: () => undefined });
}

export interface PinnedHelper {
  readonly exe: string;
  readonly sha256: string;
  readonly verifier: HelperVerifier;
  /** Synchronous re-check right before a spawn: same path, inode, size, mtime and sha256. Throws HelperUnavailableError. */
  recheck(): void;
}

interface Facts {
  ino: number;
  size: number;
  mtimeMs: number;
  sha256: string;
}

function fileFacts(exe: string): Facts {
  const st = fs.statSync(exe);
  return { ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, sha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex') };
}

const sameFacts = (a: Facts, b: Facts): boolean => a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.sha256 === b.sha256;

/**
 * Resolve once; HASH, then VERIFY the signature, then RE-HASH and compare
 * (Aegis H5: a file swapped between the codesign check and the hash would
 * otherwise pin bytes nobody verified); record the facts the pre-spawn
 * re-check compares.
 */
export function pinHelper(exePath: string, o: { verifier?: HelperVerifier; expectedSha256?: string; pins?: ReleasePins } = {}): PinnedHelper {
  let exe: string;
  try {
    exe = fs.realpathSync.native(exePath);
  } catch {
    throw new HelperUnavailableError('missing', `no helper at ${exePath} (build it: node packages/gnomon-helper/scripts/build-darwin.mjs)`);
  }
  const st0 = fs.statSync(exe);
  if (!st0.isFile() || (st0.mode & 0o111) === 0) throw new HelperUnavailableError('not-a-file', `${exe} is not an executable file`);
  if ((st0.mode & 0o022) !== 0) throw new HelperUnavailableError('unsigned', `${exe} is group- or world-writable`);
  const verifier = o.verifier ?? CODESIGN_VERIFIER;
  const expected = o.expectedSha256 ?? releaseHelperSha256(o.pins ?? loadedReleasePins());
  const before = fileFacts(exe);
  verifier.verify(exe);
  const after = fileFacts(exe);
  if (!sameFacts(before, after)) throw new HelperUnavailableError('changed', `${exe} changed while it was being verified`);
  if (expected !== undefined && expected !== after.sha256) throw new HelperUnavailableError('checksum', `${exe} does not match the sha256 this Gnomon release pins (signed, but not the shipped helper)`);
  return Object.freeze({
    exe,
    sha256: after.sha256,
    verifier,
    recheck(): void {
      let now: Facts;
      try {
        if (fs.realpathSync.native(exePath) !== exe) throw new Error('moved');
        now = fileFacts(exe);
      } catch {
        throw new HelperUnavailableError('changed', `${exe} moved or vanished after it was verified`);
      }
      if (!sameFacts(now, after)) throw new HelperUnavailableError('changed', `${exe} changed after it was verified`);
    },
  });
}

/**
 * G-HLP-01 (T-2026-10-21-028): the sha256 a release build pins for the helper on this arch, or undefined in a dev
 * build (signature + version floor only). A release that pins no helper for this arch, pins it under another
 * signing requirement, or pins one below MIN_HELPER_VERSION refuses before anything is verified or run.
 */
export function releaseHelperSha256(pins: ReleasePins, arch: string = process.arch): string | undefined {
  const p = artifactPin(pins, 'gnomon-helper', arch);
  if (p.kind === 'dev') return undefined;
  if (p.kind === 'refuse') throw new HelperUnavailableError('checksum', p.why);
  if (p.artifact.requirement !== HELPER_REQUIREMENT) throw new HelperUnavailableError('checksum', 'the release manifest pins the helper under a different signing requirement than this kernel enforces');
  if (!versionAtLeast(p.artifact.version, MIN_HELPER_VERSION)) throw new HelperUnavailableError('version', `the release pins helper ${p.artifact.version}, older than the minimum ${MIN_HELPER_VERSION}`);
  return p.artifact.sha256;
}

/** The env a helper runs with: nothing of the kernel's (no GNOMON_*, no NODE_OPTIONS). */
function helperEnv(): NodeJS.ProcessEnv {
  return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), LANG: 'C' };
}

function runOnce(pin: PinnedHelper, req: Record<string, unknown>, timeoutMs: number): HelperReply {
  pin.recheck();
  const line = `${JSON.stringify({ id: 1, ...req })}\n`;
  if (Buffer.byteLength(line) > HELPER_MAX_LINE_BYTES) throw new HelperUnavailableError('protocol', 'request too large');
  const r = spawnSync(pin.exe, ['once'], { input: line, encoding: 'utf8', timeout: timeoutMs, env: helperEnv(), maxBuffer: HELPER_MAX_LINE_BYTES * 2 });
  if (r.error) throw new HelperUnavailableError((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : 'spawn', r.error.message);
  return parseReply((r.stdout ?? '').split('\n').find((l) => l.trim() !== '') ?? '');
}

/**
 * `gnomon-helper once`, synchronously: re-checks the pin before every spawn
 * and checks the helper's `info` (protocol, version floor) on first use.
 * Residual: a one-shot child is not pid-verified (it exits before a check
 * could run); the file re-check is its only pin.
 */
export function helperOnceSync(pin: PinnedHelper): HelperOnceSync {
  let checked = false;
  return (req, timeoutMs = HELPER_SIGN_TIMEOUT_MS) => {
    if (!checked) {
      checkHelperInfo(runOnce(pin, { op: 'info' }, HELPER_OP_TIMEOUT_MS));
      checked = true;
    }
    return runOnce(pin, req, timeoutMs);
  };
}

function parseReply(line: string): HelperReply {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    throw new HelperUnavailableError('protocol', 'the helper answered something that is not JSON');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HelperUnavailableError('protocol', 'the helper answered a non-object');
  const o = v as HelperReply;
  if (o.ok !== true) {
    if (o.error === 'sandboxed') throw new HelperUnavailableError('spawn', 'the helper refuses to run sandboxed (P8-D68)');
    throw new HelperRefusal(typeof o.error === 'string' ? o.error.slice(0, 64) : 'unknown', typeof o.message === 'string' ? o.message.slice(0, 300) : '', typeof o.status === 'number' ? o.status : undefined);
  }
  return o;
}

/** `a.b.c` ≥ `min.b.c` (numeric, missing parts are 0); anything unparsable is below. */
export function versionAtLeast(v: unknown, min: string): boolean {
  if (typeof v !== 'string' || !/^\d+(\.\d+){0,2}$/.test(v)) return false;
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/** Check an `info` reply (H1 c): protocol, version floor, signing identity as the helper reports it. Returns the version. */
export function checkHelperInfo(info: HelperReply): string {
  if (info.protocol !== HELPER_PROTOCOL) throw new HelperUnavailableError('version', `the helper speaks ${String(info.protocol)}, not ${HELPER_PROTOCOL}`);
  if (!versionAtLeast(info.version, MIN_HELPER_VERSION)) throw new HelperUnavailableError('version', `helper ${String(info.version)} is older than the minimum ${MIN_HELPER_VERSION}`);
  return info.version as string;
}

/* ── the long-lived helper child (`serve`) ─────────────────────────────── */

interface Pending {
  req: Record<string, unknown>;
  timeoutMs: number;
  resolve: (r: HelperReply) => void;
  reject: (e: Error) => void;
}

/**
 * `gnomon-helper serve` as a child: the pin is re-checked before spawn, the
 * RUNNING child is code-sign-verified by pid and answers `info` with the
 * right protocol and a version at or above the floor BEFORE any request is
 * sent (H1 c, H5); then one request in flight, a bounded queue, every unlock
 * dies with it.
 */
export class HelperProcess implements HelperTransport {
  readonly #child: ChildProcess;
  readonly #queue: Pending[] = [];
  #inflight: (Pending & { id: number; timer: NodeJS.Timeout }) | null = null;
  #nextId = 1;
  #buf = Buffer.alloc(0);
  #alive = true;
  #ready = false;
  #version: string | undefined;
  readonly #exitCbs: Array<() => void> = [];
  readonly #pushCbs: Array<(p: HelperPush) => void> = [];

  /** TD-2026-10-20-514: the version this process's handshake reported (the kernel picks decision.sign from it). */
  get version(): string | undefined {
    return this.#version;
  }

  private constructor(child: ChildProcess) {
    this.#child = child;
    child.stdout!.on('data', (d: Buffer) => this.#onData(d));
    child.stderr!.on('data', () => undefined); // drained, never logged (it could carry anything)
    child.on('exit', () => this.#gone(new HelperUnavailableError('exited', 'the helper exited')));
    child.on('error', (e) => this.#gone(new HelperUnavailableError('spawn', e.message)));
    child.stdin!.on('error', () => undefined);
  }

  /** Re-check the pin synchronously, spawn, verify the running child, then handshake (`info`). */
  static start(pin: PinnedHelper): HelperProcess {
    pin.recheck();
    const child = spawn(pin.exe, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'], env: helperEnv() });
    const p = new HelperProcess(child);
    try {
      if (typeof child.pid !== 'number') throw new HelperUnavailableError('spawn', 'the helper did not start');
      pin.verifier.verifyRunning(child.pid);
    } catch (e) {
      p.#gone(e instanceof Error ? e : new HelperUnavailableError('spawn', 'helper verification failed'));
      child.kill('SIGKILL');
      return p;
    }
    // the handshake goes first; every caller request queues behind it
    p.#queue.push({
      req: { op: 'info' },
      timeoutMs: HELPER_OP_TIMEOUT_MS,
      resolve: (info) => {
        try {
          p.#version = checkHelperInfo(info);
          p.#ready = true;
        } catch (e) {
          p.#gone(e as Error);
          child.kill('SIGKILL');
        }
      },
      reject: () => undefined,
    });
    p.#pump();
    return p;
  }

  get alive(): boolean {
    return this.#alive;
  }

  /** The handshake passed (info: protocol + version floor). */
  get ready(): boolean {
    return this.#ready;
  }

  onExit(cb: () => void): void {
    if (!this.#alive) cb();
    else this.#exitCbs.push(cb);
  }

  request(req: Record<string, unknown>, timeoutMs: number = HELPER_OP_TIMEOUT_MS): Promise<HelperReply> {
    if (!this.#alive) return Promise.reject(new HelperUnavailableError('exited', 'the helper is not running'));
    if (this.#queue.length >= HELPER_MAX_QUEUED) return Promise.reject(new HelperUnavailableError('busy', 'too many helper requests queued'));
    const { id: _ignored, ...rest } = req; // the transport owns ids
    void _ignored;
    if (Buffer.byteLength(JSON.stringify(rest)) + 32 > HELPER_MAX_LINE_BYTES) return Promise.reject(new HelperUnavailableError('protocol', 'request too large'));
    return new Promise((resolve, reject) => {
      this.#queue.push({ req: rest, timeoutMs, resolve, reject });
      this.#pump();
    });
  }

  #pump(): void {
    if (this.#inflight || !this.#alive) return;
    const next = this.#queue.shift();
    if (!next) return;
    const id = this.#nextId++;
    const timer = setTimeout(() => {
      // state unknown after a timeout: kill the helper (its unlocks go with it) and fail closed
      this.#gone(new HelperUnavailableError('timeout', 'the helper did not answer in time'));
      this.#child.kill('SIGKILL');
    }, next.timeoutMs);
    this.#inflight = { ...next, id, timer };
    this.#child.stdin!.write(`${JSON.stringify({ id, ...next.req })}\n`);
  }

  #onData(d: Buffer): void {
    this.#buf = Buffer.concat([this.#buf, d]);
    let nl: number;
    while ((nl = this.#buf.indexOf(0x0a)) >= 0) {
      const line = this.#buf.subarray(0, nl).toString('utf8');
      this.#buf = this.#buf.subarray(nl + 1);
      if (line.trim() !== '') this.#onLine(line);
    }
    if (this.#buf.length > HELPER_MAX_LINE_BYTES) {
      this.#gone(new HelperUnavailableError('protocol', 'the helper sent an oversized line'));
      this.#child.kill('SIGKILL');
    }
  }

  onPush(cb: (p: HelperPush) => void): void {
    this.#pushCbs.push(cb);
  }

  #onLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      parsed = undefined;
    }
    // protocol v2: an unsolicited push (no id) may arrive at any time, in flight or not
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) && 'push' in parsed) {
      const push = this.#ready ? parseHelperPush(parsed as Record<string, unknown>) : null;
      if (!push) {
        this.#gone(new HelperUnavailableError('protocol', 'the helper pushed a malformed frame'));
        this.#child.kill('SIGKILL');
        return;
      }
      for (const cb of this.#pushCbs) {
        try {
          cb(push);
        } catch {
          /* a listener's failure never blocks the others */
        }
      }
      return;
    }
    const p = this.#inflight;
    if (!p) return; // unsolicited: ignored
    const id = parsed !== null && typeof parsed === 'object' ? (parsed as { id?: unknown }).id : undefined;
    if (id !== p.id) {
      this.#gone(new HelperUnavailableError('protocol', 'the helper answered out of order'));
      this.#child.kill('SIGKILL');
      return;
    }
    clearTimeout(p.timer);
    this.#inflight = null;
    try {
      p.resolve(parseReply(line));
    } catch (e) {
      p.reject(e as Error);
      if (!this.#ready) {
        this.#gone(new HelperUnavailableError('version', 'the helper refused the handshake'));
        this.#child.kill('SIGKILL');
      }
    }
    this.#pump();
  }

  #gone(err: Error): void {
    if (!this.#alive) return;
    this.#alive = false;
    if (this.#inflight) {
      clearTimeout(this.#inflight.timer);
      this.#inflight.reject(err);
      this.#inflight = null;
    }
    for (const q of this.#queue.splice(0)) q.reject(err);
    for (const cb of this.#exitCbs.splice(0)) {
      try {
        cb();
      } catch {
        /* a listener's failure never blocks the others */
      }
    }
  }

  async close(): Promise<void> {
    if (!this.#alive && this.#child.exitCode !== null) return;
    const exited = new Promise<void>((r) => (this.#child.exitCode !== null || this.#child.signalCode !== null ? r() : this.#child.once('exit', () => r())));
    this.#child.stdin!.end(); // EOF: the helper drops every unlock and exits
    const t = setTimeout(() => this.#child.kill('SIGKILL'), 2_000);
    await exited;
    clearTimeout(t);
    this.#gone(new HelperUnavailableError('closed', 'the helper was closed'));
  }
}

/** Restart backoff (R5): a helper that keeps dying is restarted at most this often, doubling to the cap. */
export const HELPER_RESTART_MIN_MS = 1_000;
export const HELPER_RESTART_MAX_MS = 30_000;

/**
 * A transport that (re)starts the pinned helper on demand: a helper exit
 * drops every unlock (the onExit listeners hear it), and the next request
 * re-checks the pin and starts a fresh helper with none — no sooner than the
 * backoff allows. After close() it never starts again.
 */
export class SupervisedHelper implements HelperTransport {
  #cur: HelperTransport | null = null;
  #closed = false;
  #lastStart = -Infinity;
  #backoff = 0;
  readonly #exitCbs: Array<() => void> = [];
  readonly #start: () => HelperTransport;
  readonly #now: () => number;

  constructor(start: () => HelperTransport, now: () => number = () => performance.now()) {
    this.#start = start;
    this.#now = now;
  }

  get alive(): boolean {
    return !this.#closed; // starts on demand; a failed start rejects the request
  }

  /** The current process's handshake version (undefined when none runs yet). */
  get version(): string | undefined {
    return this.#cur?.alive ? this.#cur.version : undefined;
  }

  /** A helper process is up now (an unlock can exist only in a running process). */
  get running(): boolean {
    return !this.#closed && this.#cur?.alive === true;
  }

  /** End the current process (its unlocks die with it); the next request starts a fresh one, backoff permitting. */
  async recycle(): Promise<void> {
    const t = this.#cur;
    await t?.close();
  }

  onExit(cb: () => void): void {
    this.#exitCbs.push(cb);
  }

  readonly #pushCbs: Array<(p: HelperPush) => void> = [];

  /** Pushes from whichever helper process is current (each started process is subscribed once). */
  onPush(cb: (p: HelperPush) => void): void {
    this.#pushCbs.push(cb);
  }

  #ensure(): HelperTransport {
    if (this.#closed) throw new HelperUnavailableError('closed', 'the helper was closed');
    if (this.#cur?.alive) return this.#cur;
    const now = this.#now();
    if (now - this.#lastStart < this.#backoff) throw new HelperUnavailableError('exited', `the helper exited; restart allowed in ${Math.ceil(this.#backoff - (now - this.#lastStart))} ms`);
    // the NEXT start waits at least this long after this one (1 s, doubling to 30 s; a helper that lived longer than that restarts at once)
    this.#backoff = now - this.#lastStart > HELPER_RESTART_MAX_MS ? HELPER_RESTART_MIN_MS : Math.min(HELPER_RESTART_MAX_MS, Math.max(HELPER_RESTART_MIN_MS, this.#backoff * 2));
    this.#lastStart = now;
    const t = this.#start();
    t.onPush?.((p) => {
      if (this.#cur !== t) return; // a stale process
      for (const cb of this.#pushCbs) {
        try {
          cb(p);
        } catch {
          /* ignore */
        }
      }
    });
    t.onExit(() => {
      if (this.#cur === t) this.#cur = null;
      for (const cb of this.#exitCbs) {
        try {
          cb();
        } catch {
          /* ignore */
        }
      }
    });
    this.#cur = t;
    return t;
  }

  #inFlight = 0;

  /** Requests sent and not yet answered (TD-2026-10-19-063: a helper is re-pinned only when this is 0). */
  get inFlight(): number {
    return this.#inFlight;
  }

  request(req: Record<string, unknown>, timeoutMs?: number): Promise<HelperReply> {
    let t: HelperTransport;
    try {
      t = this.#ensure();
    } catch (e) {
      return Promise.reject(e);
    }
    this.#inFlight++;
    return t.request(req, timeoutMs).finally(() => void this.#inFlight--);
  }

  async close(): Promise<void> {
    this.#closed = true;
    const t = this.#cur;
    this.#cur = null;
    await t?.close();
  }
}


export type HelperRepinOutcome = 'unchanged' | 'busy' | 'respawned' | 'refused';

/**
 * TD-2026-10-19-063 #update-watch (helper half): a changed helper binary is picked up WITHOUT a card. `check()`
 * hashes the file at the identity's helperPath; unchanged ⇒ nothing. Changed and a request in flight ⇒ `busy`
 * (tried on the next tick). Otherwise the file is re-pinned through the EXISTING verify path (pinHelper: designated
 * requirement / codesign, hash-verify-rehash) and the `serve` child recycled, so the next request starts the new
 * process through HelperProcess.start (info: protocol + the MIN_HELPER_VERSION floor, pid). `confirm` then checks
 * the respawned helper still holds this identity's keys. An unsigned or unverifiable file, or a failed confirm,
 * FAILS CLOSED: the new bytes are never started, the old pin stays (its pre-spawn recheck refuses the changed file),
 * and the same bytes are not retried.
 */
export class HelperRepin {
  readonly #o: { helperPath: string; holder: { pin: PinnedHelper }; helper: Pick<SupervisedHelper, 'inFlight' | 'recycle'>; verifier?: HelperVerifier; confirm?: () => Promise<boolean> };
  #refusedSha: string | null = null;

  constructor(o: { helperPath: string; holder: { pin: PinnedHelper }; helper: Pick<SupervisedHelper, 'inFlight' | 'recycle'>; verifier?: HelperVerifier; confirm?: () => Promise<boolean> }) {
    this.#o = o;
  }

  async check(): Promise<HelperRepinOutcome> {
    let sha: string;
    try {
      sha = createHash('sha256').update(fs.readFileSync(fs.realpathSync.native(this.#o.helperPath))).digest('hex');
    } catch {
      return 'refused';
    }
    if (sha === this.#o.holder.pin.sha256) return 'unchanged';
    if (sha === this.#refusedSha) return 'refused';
    if (this.#o.helper.inFlight > 0) return 'busy';
    let next: PinnedHelper;
    try {
      next = pinHelper(this.#o.helperPath, this.#o.verifier ? { verifier: this.#o.verifier } : {});
    } catch {
      this.#refusedSha = sha;
      return 'refused';
    }
    const prev = this.#o.holder.pin;
    this.#o.holder.pin = next;
    await this.#o.helper.recycle();
    if (this.#o.confirm) {
      const ok = await this.#o.confirm().catch(() => false);
      if (!ok) {
        this.#o.holder.pin = prev;
        this.#refusedSha = sha;
        await this.#o.helper.recycle();
        return 'refused';
      }
    }
    return 'respawned';
  }
}

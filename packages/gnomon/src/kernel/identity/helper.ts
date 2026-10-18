/**
 * @symbol #identity
 *
 * #identity (spec §3.1 root + approvals keys, §16 keys row, G-HLP-01; M1.3
 * slice 1) — the kernel's side of the signed helper (`packages/gnomon-helper`,
 * protocol `gnomon-helper:v1`, NDJSON over the child's stdin/stdout).
 *
 * TRUST BEFORE SPAWN. The kernel never runs a helper it has not pinned:
 *   1. the path is resolved ONCE (realpathSync.native) and must be a regular
 *      executable file;
 *   2. it must satisfy HELPER_REQUIREMENT — `codesign --verify --strict` plus
 *      the designated requirement: Apple anchor, Developer ID Application leaf
 *      under the Developer ID CA, team SW4BMQ8PNL, identifier gnomon.helper
 *      (identical to packages/gnomon-helper/scripts/signing.mjs);
 *   3. its sha256 (and, when given, the expected checksum) is recorded at
 *      verification and RE-CHECKED SYNCHRONOUSLY (stat + hash) right before
 *      every spawn, so a binary swapped after verification is refused.
 * A missing, unsigned or changed helper fails closed: HelperUnavailableError
 * (the callers refuse UNSUPPORTED, never a software fallback, §3.1).
 * Residual: the window between the final re-check and exec(2) itself.
 *
 * The verifier is a seam only for tests on hosts with no Developer ID build:
 * `acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK)` — programmatic only, no
 * env var or flag selects it, and gnomond never constructs it.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

export const HELPER_TEAM = 'SW4BMQ8PNL';
export const HELPER_IDENTIFIER = 'gnomon.helper';
export const HELPER_PROTOCOL = 'gnomon-helper:v1';
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
    readonly reason: 'missing' | 'not-a-file' | 'unsigned' | 'changed' | 'checksum' | 'spawn' | 'exited' | 'timeout' | 'busy' | 'protocol' | 'platform',
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

/** What the kernel talks to: one serialized request at a time. Fakes implement this in tests. */
export interface HelperTransport {
  request(req: Record<string, unknown>, timeoutMs?: number): Promise<HelperReply>;
  readonly alive: boolean;
  onExit(cb: () => void): void;
  close(): Promise<void>;
}

/** Synchronous one-shot (`gnomon-helper once`): root signatures from synchronous callers (the CLI). */
export type HelperOnceSync = (req: Record<string, unknown>, timeoutMs?: number) => HelperReply;

/* ── pinning ───────────────────────────────────────────────────────────── */

export const DEV_TEST_HELPER_ACK = 'gnomon-dev-test-helper:unsigned:never-production' as const;

export interface HelperVerifier {
  /** Throws HelperUnavailableError when `exe` is not the signed helper. */
  verify(exe: string): void;
  readonly kind: 'codesign' | 'dev-test';
}

/** Production: codesign --verify --strict + HELPER_REQUIREMENT (darwin only). */
export const CODESIGN_VERIFIER: HelperVerifier = Object.freeze({
  kind: 'codesign' as const,
  verify(exe: string): void {
    if (process.platform !== 'darwin') throw new HelperUnavailableError('platform', `no signed helper on ${process.platform} yet (Windows parity phase, P8-D78)`);
    const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${HELPER_REQUIREMENT}`, exe], { encoding: 'utf8', timeout: 30_000 });
    if (r.status !== 0) throw new HelperUnavailableError('unsigned', `${exe} does not satisfy the helper's code-signing requirement (team ${HELPER_TEAM}, ${HELPER_IDENTIFIER})`);
  },
});

/** Tests only: accept any executable (programmatic acknowledgement; never env/argv). */
export function acceptUnsignedHelperForTests(ack: typeof DEV_TEST_HELPER_ACK): HelperVerifier {
  if (ack !== DEV_TEST_HELPER_ACK) throw new Error('#identity: the unsigned-helper verifier needs DEV_TEST_HELPER_ACK');
  return Object.freeze({ kind: 'dev-test' as const, verify: () => undefined });
}

export interface PinnedHelper {
  readonly exe: string;
  readonly sha256: string;
  readonly verifier: HelperVerifier['kind'];
  /** Synchronous re-check right before a spawn: same inode, size, mtime and sha256. Throws HelperUnavailableError. */
  recheck(): void;
}

function fileFacts(exe: string): { st: fs.Stats; sha256: string } {
  const st = fs.statSync(exe);
  return { st, sha256: createHash('sha256').update(fs.readFileSync(exe)).digest('hex') };
}

/** Resolve once, verify the signature, record the facts the pre-spawn re-check compares. */
export function pinHelper(exePath: string, o: { verifier?: HelperVerifier; expectedSha256?: string } = {}): PinnedHelper {
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
  verifier.verify(exe);
  const facts = fileFacts(exe);
  if (o.expectedSha256 !== undefined && o.expectedSha256 !== facts.sha256) throw new HelperUnavailableError('checksum', `${exe} does not match the pinned sha256`);
  const pinned = { ino: facts.st.ino, size: facts.st.size, mtimeMs: facts.st.mtimeMs, sha256: facts.sha256 };
  return Object.freeze({
    exe,
    sha256: facts.sha256,
    verifier: verifier.kind,
    recheck(): void {
      let now: { st: fs.Stats; sha256: string };
      try {
        if (fs.realpathSync.native(exePath) !== exe) throw new Error('moved');
        now = fileFacts(exe);
      } catch {
        throw new HelperUnavailableError('changed', `${exe} moved or vanished after it was verified`);
      }
      if (now.st.ino !== pinned.ino || now.st.size !== pinned.size || now.st.mtimeMs !== pinned.mtimeMs || now.sha256 !== pinned.sha256) {
        throw new HelperUnavailableError('changed', `${exe} changed after it was verified`);
      }
    },
  });
}

/** The env a helper runs with: nothing of the kernel's (no GNOMON_*, no NODE_OPTIONS). */
function helperEnv(): NodeJS.ProcessEnv {
  return { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...(process.env.HOME ? { HOME: process.env.HOME } : {}), LANG: 'C' };
}

/** `gnomon-helper once`, synchronously (re-checks the pin first). */
export function helperOnceSync(pin: PinnedHelper): HelperOnceSync {
  return (req, timeoutMs = HELPER_SIGN_TIMEOUT_MS) => {
    pin.recheck();
    const line = `${JSON.stringify({ id: 1, ...req })}\n`;
    if (Buffer.byteLength(line) > HELPER_MAX_LINE_BYTES) throw new HelperUnavailableError('protocol', 'request too large');
    const r = spawnSync(pin.exe, ['once'], { input: line, encoding: 'utf8', timeout: timeoutMs, env: helperEnv(), maxBuffer: HELPER_MAX_LINE_BYTES * 2 });
    if (r.error) throw new HelperUnavailableError((r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timeout' : 'spawn', r.error.message);
    return parseReply((r.stdout ?? '').split('\n').find((l) => l.trim() !== '') ?? '');
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

/* ── the long-lived helper child (`serve`) ─────────────────────────────── */

interface Pending {
  line: string;
  timeoutMs: number;
  resolve: (r: HelperReply) => void;
  reject: (e: Error) => void;
}

/** `gnomon-helper serve` as a child: one request in flight, a bounded queue, every unlock dies with it. */
export class HelperProcess implements HelperTransport {
  readonly #child: ChildProcess;
  readonly #queue: Pending[] = [];
  #inflight: (Pending & { id: number; timer: NodeJS.Timeout }) | null = null;
  #nextId = 1;
  #buf = Buffer.alloc(0);
  #alive = true;
  readonly #exitCbs: Array<() => void> = [];

  private constructor(child: ChildProcess) {
    this.#child = child;
    child.stdout!.on('data', (d: Buffer) => this.#onData(d));
    child.stderr!.on('data', () => undefined); // drained, never logged (it could carry anything)
    child.on('exit', () => this.#gone(new HelperUnavailableError('exited', 'the helper exited')));
    child.on('error', (e) => this.#gone(new HelperUnavailableError('spawn', e.message)));
    child.stdin!.on('error', () => undefined);
  }

  /** Re-check the pin synchronously, then spawn. */
  static start(pin: PinnedHelper): HelperProcess {
    pin.recheck();
    const child = spawn(pin.exe, ['serve'], { stdio: ['pipe', 'pipe', 'pipe'], env: helperEnv() });
    return new HelperProcess(child);
  }

  get alive(): boolean {
    return this.#alive;
  }

  onExit(cb: () => void): void {
    if (!this.#alive) cb();
    else this.#exitCbs.push(cb);
  }

  request(req: Record<string, unknown>, timeoutMs: number = HELPER_OP_TIMEOUT_MS): Promise<HelperReply> {
    if (!this.#alive) return Promise.reject(new HelperUnavailableError('exited', 'the helper is not running'));
    if (this.#queue.length >= HELPER_MAX_QUEUED) return Promise.reject(new HelperUnavailableError('busy', 'too many helper requests queued'));
    return new Promise((resolve, reject) => {
      const { id: _drop, ...rest } = req;
      void _drop;
      const line = JSON.stringify(rest);
      if (Buffer.byteLength(line) + 32 > HELPER_MAX_LINE_BYTES) return reject(new HelperUnavailableError('protocol', 'request too large'));
      this.#queue.push({ line, timeoutMs, resolve, reject });
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
    this.#child.stdin!.write(`{"id":${id},${next.line.slice(1)}\n`);
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

  #onLine(line: string): void {
    const p = this.#inflight;
    if (!p) return; // unsolicited: ignored
    let id: unknown;
    try {
      id = (JSON.parse(line) as { id?: unknown }).id;
    } catch {
      id = undefined;
    }
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
    if (!this.#alive) return;
    const exited = new Promise<void>((r) => this.#child.once('exit', () => r()));
    this.#child.stdin!.end(); // EOF: the helper drops every unlock and exits
    const t = setTimeout(() => this.#child.kill('SIGKILL'), 2_000);
    await exited;
    clearTimeout(t);
  }
}

/**
 * A transport that (re)starts the pinned helper on demand: a helper exit
 * drops every unlock (the onExit listeners hear it), and the next request
 * re-checks the pin and starts a fresh helper with none.
 */
export class SupervisedHelper implements HelperTransport {
  #cur: HelperTransport | null = null;
  readonly #exitCbs: Array<() => void> = [];
  readonly #start: () => HelperTransport;

  constructor(start: () => HelperTransport) {
    this.#start = start;
  }

  get alive(): boolean {
    return true; // starts on demand; a failed start rejects the request
  }

  onExit(cb: () => void): void {
    this.#exitCbs.push(cb);
  }

  #ensure(): HelperTransport {
    if (this.#cur?.alive) return this.#cur;
    const t = this.#start();
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

  request(req: Record<string, unknown>, timeoutMs?: number): Promise<HelperReply> {
    let t: HelperTransport;
    try {
      t = this.#ensure();
    } catch (e) {
      return Promise.reject(e);
    }
    return t.request(req, timeoutMs);
  }

  async close(): Promise<void> {
    const t = this.#cur;
    this.#cur = null;
    await t?.close();
  }
}

/**
 * @symbol #trace-capture
 *
 * #trace-capture, the writer. For a traced project folder (mode.ts) every Claude session's raw stream-json
 * traffic is teed to `<project>/.gnomon/trace/<file>.jsonl`, one JSON record per line (LF):
 *
 *   {t: ISO time, dir: 'in' | 'out' | 'ctl', line: <the raw stream-json object>}
 *
 *   in  = what the kernel wrote to claude's stdin (user turns, permission answers, control messages);
 *   out = what claude wrote on stdout (each line as the splitter delivered it);
 *   ctl = kernel-side notes: `{event:'open'}`, `{event:'spawn', argv, envKeys}` (argv secrets redacted, env as
 *         NAMES only — the session.sandbox row's posture), `{event:'line-dropped', bytes}` (an over-cap stdout line),
 *         `{event:'drain-interrupt'}`, `{event:'exit', code, signal}`, `{event:'dropped', count}`,
 *         `{event:'capped', capBytes}`, `{event:'redacted', count}`.
 *   A line that is not a JSON object is recorded as its raw string.
 *
 * FILE NAME: `traceFileName(hsid)` = the hsid with every ':' as '-' (`hsid-v1-<ULID>.jsonl`), because ':' is not
 * a legal path character on Windows. A resumed session (same hsid) appends to its file.
 *
 * FILE SAFETY: `<project>` is the realpath of the session cwd. `.gnomon` and `trace` must be plain directories
 * (a symlink at either refuses `trace-unsafe`). `trace/` is created 0700 (an existing one wider than owner-only
 * refuses), holds a `.gitignore` of `*` (created once, exclusively; the repo's own .gitignore is never touched),
 * and each file is created O_EXCL | O_NOFOLLOW at 0600 (an existing one is reopened O_NOFOLLOW only if it is a
 * plain owner-only file of ours). The session profile read- and write-denies `<cwd>/.gnomon/trace` and
 * write-denies `<cwd>/.gnomon` itself (manifest/policy.ts), so a session can neither read, hide nor alter its own
 * trace.
 *
 * NEVER BLOCKS A SESSION: records go into a bounded in-memory queue (TRACE_QUEUE_BOUND_LINES records,
 * TRACE_QUEUE_BOUND_BYTES bytes) drained by ONE async writer. A record that does not fit is dropped and counted,
 * and a `{event:'dropped', count}` note is written as soon as there is room. The file is bounded at
 * TRACE_FILE_BOUND_BYTES: the record that would pass the bound is replaced by `{event:'capped'}` and capture stops.
 *
 * SECRETS: the stream between the kernel and claude carries no key or token by construction; this is asserted on
 * every record: a record holding a private-key PEM, a Gnomon read token (`grt:v1:`), an Anthropic API key
 * (`sk-ant-`) or one of the caller's known secret values keeps its envelope but its `line` becomes
 * `{redacted:'secret-shaped', hash, bytes}`, counted in a `{event:'redacted'}` note at close.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { currentUid } from '../lifecycle/home.js';

export const TRACE_REPO_DIR = '.gnomon';
export const TRACE_DIR = 'trace';
export const TRACE_GITIGNORE = '.gitignore';
/** A configured bound on one trace file's size, not a measurement. */
export const TRACE_FILE_BOUND_BYTES = 50 * 1024 * 1024;
/** Configured bounds on the in-memory queue between the session and the disk. */
export const TRACE_QUEUE_BOUND_LINES = 1024;
export const TRACE_QUEUE_BOUND_BYTES = 8 * 1024 * 1024;
/** Room kept below the file bound for the `capped` note itself. */
const CAP_NOTE_ROOM = 256;

const O_NOFOLLOW: number = fs.constants.O_NOFOLLOW ?? 0;
const POSIX = process.platform !== 'win32';

export type TraceDir = 'in' | 'out' | 'ctl';
export type TraceRefusal = 'trace-unsafe' | 'trace-unavailable';

export class TraceRefused extends Error {
  constructor(
    readonly reason: TraceRefusal,
    message: string,
  ) {
    super(`#trace-capture: ${message}`);
    this.name = 'TraceRefused';
  }
}

/** The disk side of a trace stream (the default appends to an fd; tests pass a slow stub). */
export interface TraceSink {
  write(text: string): Promise<void>;
  close(): Promise<void>;
}

export interface TraceOpenOptions {
  /** the file bound (default TRACE_FILE_BOUND_BYTES) */
  fileBoundBytes?: number;
  queueBoundLines?: number;
  queueBoundBytes?: number;
  /** replaces the default fd sink (the file is still created, with its modes) */
  sink?: (fd: number) => TraceSink;
  /** exact values that must never appear in a record (e.g. the session env's secret-named values) */
  secrets?: readonly string[];
  now?: () => Date;
}

export const traceFileName = (hsid: string): string => `${hsid.replace(/:/g, '-')}.jsonl`;
export const traceDirOf = (projectReal: string): string => path.join(projectReal, TRACE_REPO_DIR, TRACE_DIR);

/** Ensure `p` is a plain directory of ours (create it with `mode` if absent); a symlink or a foreign dir refuses. */
function plainDir(p: string, mode: number, ownerOnly: boolean): void {
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(p);
  } catch {
    st = null;
  }
  if (!st) {
    try {
      fs.mkdirSync(p, { mode });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new TraceRefused('trace-unavailable', `cannot create ${p}: ${(e as Error).message}`);
    }
    st = fs.lstatSync(p);
    if (ownerOnly && POSIX && !st.isSymbolicLink() && (st.mode & 0o777) !== mode) {
      fs.chmodSync(p, mode); // umask
      st = fs.lstatSync(p);
    }
  }
  if (st.isSymbolicLink()) throw new TraceRefused('trace-unsafe', `${p} is a symlink`);
  if (!st.isDirectory()) throw new TraceRefused('trace-unsafe', `${p} is not a directory`);
  const uid = currentUid();
  if (uid !== null && st.uid !== uid) throw new TraceRefused('trace-unsafe', `${p} is owned by uid ${st.uid}, not ${uid}`);
  if (ownerOnly && POSIX && (st.mode & 0o077) !== 0) throw new TraceRefused('trace-unsafe', `${p} mode ${(st.mode & 0o777).toString(8)} is not owner-only`);
}

/** Create, or reopen for append, one owner-only trace file; never through a symlink. Returns the fd and its size. */
function openTraceFile(file: string): { fd: number; size: number } {
  try {
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
    if (POSIX) fs.fchmodSync(fd, 0o600);
    return { fd, size: 0 };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new TraceRefused('trace-unavailable', `cannot create ${path.basename(file)}: ${(e as Error).message}`);
  }
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | O_NOFOLLOW);
  } catch (e) {
    throw new TraceRefused('trace-unsafe', `cannot reopen ${path.basename(file)} (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  const st = fs.fstatSync(fd);
  const uid = currentUid();
  if (!st.isFile() || st.nlink !== 1 || (uid !== null && st.uid !== uid) || (POSIX && (st.mode & 0o077) !== 0)) {
    fs.closeSync(fd);
    throw new TraceRefused('trace-unsafe', `${path.basename(file)} is not a plain owner-only file`);
  }
  return { fd, size: st.size };
}

function fdSink(fd: number): TraceSink {
  return {
    write: (text) => new Promise<void>((resolve, reject) => fs.write(fd, text, null, 'utf8', (err) => (err ? reject(err) : resolve()))),
    close: () => new Promise<void>((resolve) => fs.close(fd, () => resolve())),
  };
}

const SECRET_SHAPES = [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, /grt:v1:[A-Za-z0-9]/, /sk-ant-[A-Za-z0-9_-]{8,}/];

/** Does `text` carry a key or token shape (or one of `secrets`)? */
export function secretShaped(text: string, secrets: readonly string[] = []): boolean {
  return SECRET_SHAPES.some((r) => r.test(text)) || secrets.some((s) => s.length >= 8 && text.includes(s));
}

/** argv for a `ctl` spawn note: the free-text values (the appended system prompt) become `<redacted sha256:… bytes=N>`. */
export function redactArgv(argv: readonly string[]): string[] {
  const FREE_TEXT = new Set(['--append-system-prompt', '--system-prompt']);
  return argv.map((a, i) => {
    const prev = argv[i - 1];
    if (prev !== undefined && FREE_TEXT.has(prev)) return `<redacted sha256:${createHash('sha256').update(a).digest('hex')} bytes=${Buffer.byteLength(a)}>`;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0 && FREE_TEXT.has(a.slice(0, eq))) return `${a.slice(0, eq)}=<redacted bytes=${Buffer.byteLength(a.slice(eq + 1))}>`;
    return a;
  });
}

/** One session's trace stream. Every method is synchronous and never throws; the disk is written behind it. */
export class TraceStream {
  readonly file: string;
  readonly #sink: TraceSink;
  readonly #fileBound: number;
  readonly #qLines: number;
  readonly #qBytes: number;
  readonly #secrets: readonly string[];
  readonly #now: () => Date;
  #queue: string[] = [];
  #queuedBytes = 0;
  #written: number;
  #dropped = 0;
  #redacted = 0;
  #capped = false;
  #closed = false;
  #writing: Promise<void> | null = null;
  #failed = false;

  constructor(file: string, sink: TraceSink, size: number, o: TraceOpenOptions) {
    this.file = file;
    this.#sink = sink;
    this.#written = size;
    this.#fileBound = o.fileBoundBytes ?? TRACE_FILE_BOUND_BYTES;
    this.#qLines = o.queueBoundLines ?? TRACE_QUEUE_BOUND_LINES;
    this.#qBytes = o.queueBoundBytes ?? TRACE_QUEUE_BOUND_BYTES;
    this.#secrets = o.secrets ?? [];
    this.#now = o.now ?? ((): Date => new Date());
  }

  /** A raw stdin line as written (its trailing LF is not part of the record). */
  in(raw: string): void {
    this.#record('in', raw.replace(/\r?\n$/, ''));
  }

  /** A raw stdout line as received. */
  out(raw: string): void {
    this.#record('out', raw);
  }

  ctl(note: Record<string, unknown>): void {
    this.#push(this.#encode('ctl', note));
  }

  /** dropped / capped / redacted counts so far (tests, status). */
  stats(): { dropped: number; redacted: number; capped: boolean; written: number } {
    return { dropped: this.#dropped, redacted: this.#redacted, capped: this.#capped, written: this.#written };
  }

  /** Flush what is queued, then close the file. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#redacted > 0) this.ctl({ event: 'redacted', count: this.#redacted });
    this.#closed = true;
    while (this.#writing) await this.#writing;
    await this.#sink.close().catch(() => undefined);
  }

  #record(dir: 'in' | 'out', raw: string): void {
    let line: unknown = raw;
    try {
      const v: unknown = JSON.parse(raw);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) line = v;
    } catch {
      /* not JSON: kept as the raw string */
    }
    this.#push(this.#encode(dir, line));
  }

  #encode(dir: TraceDir, line: unknown): string {
    const t = this.#now().toISOString();
    let text = `${JSON.stringify({ t, dir, line })}\n`;
    if (secretShaped(text, this.#secrets)) {
      this.#redacted++;
      const body = typeof line === 'string' ? line : JSON.stringify(line);
      text = `${JSON.stringify({ t, dir, line: { redacted: 'secret-shaped', hash: `sha256:${createHash('sha256').update(body).digest('hex')}`, bytes: Buffer.byteLength(body) } })}\n`;
    }
    return text;
  }

  #push(text: string): void {
    if (this.#closed || this.#capped || this.#failed) return;
    const bytes = Buffer.byteLength(text);
    if (this.#queue.length >= this.#qLines || this.#queuedBytes + bytes > this.#qBytes) {
      this.#dropped++;
      return;
    }
    if (this.#dropped > 0) {
      const note = this.#encode('ctl', { event: 'dropped', count: this.#dropped });
      this.#dropped = 0;
      this.#enqueue(note);
      if (this.#capped) return;
    }
    this.#enqueue(text);
  }

  #enqueue(text: string): void {
    const bytes = Buffer.byteLength(text);
    const committed = this.#written + this.#queuedBytes;
    if (committed + bytes > this.#fileBound - CAP_NOTE_ROOM) {
      this.#capped = true;
      const note = this.#encode('ctl', { event: 'capped', capBytes: this.#fileBound });
      this.#queue.push(note);
      this.#queuedBytes += Buffer.byteLength(note);
    } else {
      this.#queue.push(text);
      this.#queuedBytes += bytes;
    }
    this.#kick();
  }

  #kick(): void {
    if (this.#writing || this.#queue.length === 0) return;
    this.#writing = (async () => {
      while (this.#queue.length > 0 && !this.#failed) {
        const batch = this.#queue.splice(0, this.#queue.length);
        const text = batch.join('');
        const bytes = Buffer.byteLength(text);
        try {
          await this.#sink.write(text);
          this.#written += bytes;
        } catch {
          this.#failed = true; // a disk error ends capture; the session is never touched
        }
        this.#queuedBytes -= bytes;
      }
      this.#queue = [];
      this.#queuedBytes = 0;
      this.#writing = null;
    })();
  }
}

/**
 * Open the trace stream of one session in a traced project. `projectCwd` is the session cwd (resolved to its
 * realpath here). Throws TraceRefused (`trace-unsafe`: a symlink, a foreign or non-owner-only dir or file;
 * `trace-unavailable`: the folder cannot be created).
 */
export function openTraceStream(projectCwd: string, hsid: string, o: TraceOpenOptions = {}): TraceStream {
  let real: string;
  try {
    real = fs.realpathSync.native(projectCwd);
  } catch (e) {
    throw new TraceRefused('trace-unavailable', `the project folder does not resolve: ${(e as Error).message}`);
  }
  plainDir(path.join(real, TRACE_REPO_DIR), 0o700, false);
  const dir = traceDirOf(real);
  plainDir(dir, 0o700, true);
  const ignore = path.join(dir, TRACE_GITIGNORE);
  try {
    const fd = fs.openSync(ignore, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
    try {
      fs.writeFileSync(fd, '*\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new TraceRefused('trace-unavailable', `cannot write ${TRACE_GITIGNORE}: ${(e as Error).message}`);
  }
  const file = path.join(dir, traceFileName(hsid));
  const { fd, size } = openTraceFile(file);
  return new TraceStream(file, (o.sink ?? fdSink)(fd), size, o);
}

/**
 * @symbol #trace-capture
 *
 * #trace-capture, the writer. For a traced project folder (mode.ts) every Claude session's raw stream-json
 * traffic is teed to a file in the GNOMON HOME (TD-2026-10-19-057, amending TD-2026-10-19-139), one JSON record
 * per line (LF):
 *
 *   <home>/trace/<project key>/<traceFileName(hsid)>        {t: ISO time, dir: 'in' | 'out' | 'ctl', line: …}
 *   <home>/trace/<project key>/project.json                 {schemaVersion, realpath}  (which folder the key names)
 *
 *   in  = what the kernel wrote to claude's stdin (user turns, permission answers, control messages);
 *   out = what claude wrote on stdout (each line as the splitter delivered it);
 *   ctl = kernel-side notes: `open-failed`, `spawn` (argv secrets redacted, env as NAMES only), `line-dropped`,
 *         `drain-interrupt`, `stdin-close`, `exit`, `dropped {count, priority?}`, `capped {capBytes, mode}`,
 *         `out-skipped {count}`, `redacted {count}`, `prior-close-unclean`.
 *   A line that is not a JSON object is recorded as its raw string.
 *
 * NOTHING IS WRITTEN INTO THE PROJECT TREE. The session profile read- and write-denies the whole Gnomon home,
 * renames included (manifest/policy.ts `gnomon-home`), so a session can neither read, hide nor alter its trace.
 *
 * PROJECT KEY: `traceProjectKey(realpath)` = a short readable slug of the folder name ([a-z0-9-], at most 40
 * chars, 'root' if empty) + '-' + the first 12 hex of sha256(realpath), e.g. `a-paradigm-3f9c1e2a07b4`. No ':'
 * (Windows). project.json records the realpath; a key dir whose project.json names another folder (a hash-prefix
 * collision, or a planted file) refuses `trace-unsafe`.
 *
 * FILE NAME: `traceFileName(hsid)` = the hsid with every ':' as '-'. A resumed session (same hsid) appends; when the
 * file's last record is not the `exit` note, a `prior-close-unclean` note is written first.
 *
 * FILE SAFETY: dirs 0700 and files 0600, owner-checked; no symlink anywhere on our part of the path. A trace file is
 * lstat'd and must be a regular file, then opened O_NOFOLLOW | O_NONBLOCK (a FIFO planted between the lstat and the
 * open can neither hang the kernel nor pass the fstat check); new files are created O_EXCL. O_NONBLOCK has no effect
 * on a regular file, so it is not cleared (Node has no fcntl).
 *
 * NEVER BLOCKS A SESSION: records go into a bounded in-memory queue drained by ONE async writer. When the queue is
 * full an `out` record is dropped; an `in` or `ctl` record evicts the newest queued `out` record instead, and may
 * use a reserve of the same size again; only past that is it dropped (counted as `priority`). Drops are reported in
 * a `{event:'dropped'}` note.
 *
 * BOUNDS (configured, not measured; Aegis M1: the audit cannot be capped off):
 *   - one record is at most TRACE_RECORD_BOUND_BYTES: a larger one keeps {truncated:'record-cap', type, subtype,
 *     bytes, hash, head} (head = the start of the redacted line text);
 *   - past TRACE_FILE_BOUND_BYTES one `capped` note is written and recording goes on: every `in` and `ctl` record
 *     still in full (each record-capped), each `out` record as a skeleton {skeleton:true, type, subtype, tools:
 *     [{name, id}]};
 *   - past TRACE_FILE_HARD_BOUND_FACTOR × the file bound, `out` skeletons are only counted (`out-skipped`); `in`
 *     and `ctl` records are still written.
 *
 * SECRETS (Aegis M2, L4): the stream carries no key or token by construction; this is asserted on every record by
 * walking the decoded JSON value (so escapes cannot hide a match) and replacing ONLY each matched span with
 * `[redacted:<kind>]`: the record and its structure stay visible. Kinds: private-key, gnomon-read-token,
 * anthropic-key, github-token, aws-key, slack-token, secret-value (one of the caller's known values, >= 8 chars).
 * The count is reported in a `redacted` note at close.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { TRACE_REFUSALS, type TraceRefusalValue } from '@a-company/gnomon-contracts';
import { currentUid } from '../lifecycle/home.js';

/** The trace root inside the Gnomon home. */
export const TRACE_HOME_DIR = 'trace';
export const TRACE_PROJECT_FILE = 'project.json';
export const TRACE_PROJECT_SCHEMA = 'gnomon-trace-project:v1' as const;
/** A configured bound on one trace file's full-content size, not a measurement. */
export const TRACE_FILE_BOUND_BYTES = 50 * 1024 * 1024;
/** Past this multiple of the file bound, `out` skeletons are only counted. */
export const TRACE_FILE_HARD_BOUND_FACTOR = 4;
/** A configured bound on one record. */
export const TRACE_RECORD_BOUND_BYTES = 64 * 1024;
/** Configured bounds on the in-memory queue between the session and the disk. */
export const TRACE_QUEUE_BOUND_LINES = 1024;
export const TRACE_QUEUE_BOUND_BYTES = 8 * 1024 * 1024;
/** How long a drain waits for a session's trace to reach the disk (Aegis L3). */
export const TRACE_DRAIN_FLUSH_MS = 2000;
/** Room kept below the file bound for the `capped` note itself. */
const CAP_NOTE_ROOM = 256;
/** How much of a resumed file's tail is read to find its last record. */
const TAIL_BYTES = TRACE_RECORD_BOUND_BYTES * 2;

const O_NOFOLLOW: number = fs.constants.O_NOFOLLOW ?? 0;
const O_NONBLOCK: number = fs.constants.O_NONBLOCK ?? 0;
const POSIX = process.platform !== 'win32';

export type TraceDir = 'in' | 'out' | 'ctl';
/** The closed `session.sandbox{traceRefused}` values, published by gnomon-contracts (D98_CLOSED_VALUES). */
export { TRACE_REFUSALS };
export type TraceRefusal = TraceRefusalValue;

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
  /** the full-content file bound (default TRACE_FILE_BOUND_BYTES) */
  fileBoundBytes?: number;
  /** the per-record bound (default TRACE_RECORD_BOUND_BYTES) */
  recordBoundBytes?: number;
  queueBoundLines?: number;
  queueBoundBytes?: number;
  /** replaces the default fd sink (the file is still created, with its modes) */
  sink?: (fd: number) => TraceSink;
  /** exact values that must never appear in a record (e.g. the session env's secret-named values) */
  secrets?: readonly string[];
  now?: () => Date;
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

export const traceFileName = (hsid: string): string => `${hsid.replace(/:/g, '-')}.jsonl`;

/** `<slug>-<12 hex>`: readable, filename-safe on every platform, keyed by the folder's realpath. */
export function traceProjectKey(projectReal: string): string {
  const trim = (s: string): string => s.replace(/^-+|-+$/g, '');
  const slug = trim(trim(path.basename(projectReal).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40)) || 'root';
  return `${slug}-${sha256(projectReal).slice(0, 12)}`;
}

/** `<home>/trace` */
export const traceRootOf = (home: string): string => path.join(home, TRACE_HOME_DIR);
/** `<home>/trace/<project key>` for a project folder's realpath. */
export const traceDirOf = (home: string, projectReal: string): string => path.join(traceRootOf(home), traceProjectKey(projectReal));

/** Ensure `p` is a plain owner-only directory of ours (create it 0700 if absent); a symlink or a foreign dir refuses. */
function plainDir(p: string): void {
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(p);
  } catch {
    st = null;
  }
  if (!st) {
    try {
      fs.mkdirSync(p, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw new TraceRefused('trace-unavailable', `cannot create ${p}: ${(e as Error).message}`);
    }
    st = fs.lstatSync(p);
    if (POSIX && st.isDirectory() && (st.mode & 0o777) !== 0o700) {
      fs.chmodSync(p, 0o700); // umask
      st = fs.lstatSync(p);
    }
  }
  if (st.isSymbolicLink()) throw new TraceRefused('trace-unsafe', `${p} is a symlink`);
  if (!st.isDirectory()) throw new TraceRefused('trace-unsafe', `${p} is not a directory`);
  const uid = currentUid();
  if (uid !== null && st.uid !== uid) throw new TraceRefused('trace-unsafe', `${p} is owned by uid ${st.uid}, not ${uid}`);
  if (POSIX && (st.mode & 0o077) !== 0) throw new TraceRefused('trace-unsafe', `${p} mode ${(st.mode & 0o777).toString(8)} is not owner-only`);
}

/** Refuse anything at `file` that is not a regular file (a link, a FIFO, a device, a dir). Absent is fine. */
function lstatRegular(file: string): fs.Stats | null {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!st.isFile()) throw new TraceRefused('trace-unsafe', `${path.basename(file)} is not a regular file`);
  return st;
}

/** Open an existing file of ours non-blocking and without following a link; refuse anything but a plain owner-only file. */
function openExisting(file: string, flags: number): { fd: number; size: number } {
  lstatRegular(file);
  let fd: number;
  try {
    fd = fs.openSync(file, flags | O_NOFOLLOW | O_NONBLOCK);
  } catch (e) {
    throw new TraceRefused('trace-unsafe', `cannot open ${path.basename(file)} (${(e as NodeJS.ErrnoException).code ?? 'error'})`);
  }
  const st = fs.fstatSync(fd);
  const uid = currentUid();
  if (!st.isFile() || st.nlink !== 1 || (uid !== null && st.uid !== uid) || (POSIX && (st.mode & 0o077) !== 0)) {
    fs.closeSync(fd);
    throw new TraceRefused('trace-unsafe', `${path.basename(file)} is not a plain owner-only file`);
  }
  return { fd, size: st.size };
}

/** Create exclusively (0600) or return null when it exists. */
function createExclusive(file: string, flags: number): number | null {
  if (lstatRegular(file)) return null;
  try {
    const fd = fs.openSync(file, flags | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW | O_NONBLOCK, 0o600);
    if (POSIX) fs.fchmodSync(fd, 0o600);
    return fd;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null;
    throw new TraceRefused('trace-unavailable', `cannot create ${path.basename(file)}: ${(e as Error).message}`);
  }
}

/** Record (or check) which folder a key dir belongs to. */
function claimKeyDir(dir: string, projectReal: string): void {
  const file = path.join(dir, TRACE_PROJECT_FILE);
  const fd = createExclusive(file, fs.constants.O_WRONLY);
  if (fd !== null) {
    try {
      fs.writeFileSync(fd, `${JSON.stringify({ schemaVersion: TRACE_PROJECT_SCHEMA, realpath: projectReal })}\n`);
    } finally {
      fs.closeSync(fd);
    }
    return;
  }
  const { fd: rfd } = openExisting(file, fs.constants.O_RDONLY);
  type ProjectDoc = { schemaVersion?: unknown; realpath?: unknown };
  let doc: ProjectDoc | null = null;
  try {
    doc = JSON.parse(fs.readFileSync(rfd, 'utf8')) as ProjectDoc | null;
  } catch {
    doc = null;
  } finally {
    fs.closeSync(rfd);
  }
  if (doc?.schemaVersion !== TRACE_PROJECT_SCHEMA || doc.realpath !== projectReal) throw new TraceRefused('trace-unsafe', `${path.basename(dir)}/${TRACE_PROJECT_FILE} names another folder`);
}

/** Does the file's last record say the previous writer closed it cleanly (the `exit` note, LF-terminated)? */
function closedCleanly(fd: number, size: number): { clean: boolean; endsWithLf: boolean } {
  const n = Math.min(size, TAIL_BYTES);
  const buf = Buffer.alloc(n);
  fs.readSync(fd, buf, 0, n, size - n);
  const text = buf.toString('utf8');
  const endsWithLf = text.endsWith('\n');
  if (!endsWithLf) return { clean: false, endsWithLf };
  const last = text.slice(0, -1).split('\n').at(-1) ?? '';
  try {
    const o = JSON.parse(last) as { dir?: unknown; line?: { event?: unknown } };
    return { clean: o.dir === 'ctl' && o.line?.event === 'exit', endsWithLf };
  } catch {
    return { clean: false, endsWithLf };
  }
}

/** Create, or reopen for append, one owner-only trace file. */
function openTraceFile(file: string): { fd: number; size: number; clean: boolean; endsWithLf: boolean } {
  const created = createExclusive(file, fs.constants.O_WRONLY | fs.constants.O_APPEND);
  if (created !== null) return { fd: created, size: 0, clean: true, endsWithLf: true };
  const { fd, size } = openExisting(file, fs.constants.O_RDWR | fs.constants.O_APPEND);
  if (size === 0) return { fd, size, clean: true, endsWithLf: true };
  try {
    return { fd, size, ...closedCleanly(fd, size) };
  } catch {
    return { fd, size, clean: false, endsWithLf: false };
  }
}

function fdSink(fd: number): TraceSink {
  return {
    write: (text) => new Promise<void>((resolve, reject) => fs.write(fd, text, null, 'utf8', (err) => (err ? reject(err) : resolve()))),
    close: () => new Promise<void>((resolve) => fs.close(fd, () => resolve())),
  };
}

/* ── secrets: span redaction on the decoded value ─────────────────────────── */

const SECRET_SHAPES: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { kind: 'gnomon-read-token', re: /grt:v1:[A-Za-z0-9][^\s"'`<>]*/g },
  { kind: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/g },
  { kind: 'github-token', re: /\b(?:ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'slack-token', re: /\bxox[bp]-[A-Za-z0-9-]{10,}/g },
];

/** Replace every secret-shaped span of `s` (or one of `secrets`) with `[redacted:<kind>]`. */
export function redactText(s: string, secrets: readonly string[] = []): { text: string; count: number } {
  let count = 0;
  let text = s;
  for (const { kind, re } of SECRET_SHAPES) {
    text = text.replace(re, () => (count++, `[redacted:${kind}]`));
  }
  for (const v of secrets) {
    if (v.length < 8) continue;
    const parts = text.split(v);
    if (parts.length > 1) {
      count += parts.length - 1;
      text = parts.join('[redacted:secret-value]');
    }
  }
  return { text, count };
}

/** Walk a decoded JSON value (keys and string values); returns the redacted copy and the number of spans replaced. */
export function redactValue(v: unknown, secrets: readonly string[] = []): { value: unknown; count: number } {
  let count = 0;
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const r = redactText(x, secrets);
      count += r.count;
      return r.text;
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x)) out[walk(k) as string] = walk(val);
      return out;
    }
    return x;
  };
  const value = walk(v);
  return { value, count };
}

/** Does `text` carry a key or token shape (or one of `secrets`)? */
export function secretShaped(text: string, secrets: readonly string[] = []): boolean {
  return redactText(text, secrets).count > 0;
}

/** argv for a `ctl` spawn note: the free-text values (the appended system prompt) become `<redacted sha256:… bytes=N>`. */
export function redactArgv(argv: readonly string[]): string[] {
  const FREE_TEXT = new Set(['--append-system-prompt', '--system-prompt']);
  return argv.map((a, i) => {
    const prev = argv[i - 1];
    if (prev !== undefined && FREE_TEXT.has(prev)) return `<redacted sha256:${sha256(a)} bytes=${Buffer.byteLength(a)}>`;
    const eq = a.indexOf('=');
    if (a.startsWith('--') && eq > 0 && FREE_TEXT.has(a.slice(0, eq))) return `${a.slice(0, eq)}=<redacted bytes=${Buffer.byteLength(a.slice(eq + 1))}>`;
    return a;
  });
}

/* ── record shapes ────────────────────────────────────────────────────────── */

const field = (v: unknown, k: string): unknown => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined);
const shortStr = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(0, 128) : undefined);

/** The compact form of an `out` record past the file bound: type, subtype and each tool_use's name and id. */
export function outSkeleton(line: unknown): Record<string, unknown> {
  const tools: Array<{ name: string | null; id: string | null }> = [];
  const visit = (x: unknown, depth: number): void => {
    if (depth > 6 || x === null || typeof x !== 'object') return;
    if (Array.isArray(x)) {
      for (const y of x) visit(y, depth + 1);
      return;
    }
    if (field(x, 'type') === 'tool_use') tools.push({ name: shortStr(field(x, 'name')) ?? null, id: shortStr(field(x, 'id')) ?? null });
    for (const k of ['message', 'content', 'content_block', 'event']) visit(field(x, k), depth + 1);
  };
  visit(line, 0);
  const type = shortStr(field(line, 'type'));
  const subtype = shortStr(field(line, 'subtype'));
  return { skeleton: true, ...(type !== undefined ? { type } : {}), ...(subtype !== undefined ? { subtype } : {}), ...(tools.length ? { tools } : {}) };
}

interface Queued {
  text: string;
  dir: TraceDir;
  bytes: number;
}

/** One session's trace stream. Every method is synchronous and never throws; the disk is written behind it. */
export class TraceStream {
  readonly file: string;
  readonly #sink: TraceSink;
  readonly #fileBound: number;
  readonly #hardBound: number;
  readonly #recordBound: number;
  readonly #qLines: number;
  readonly #qBytes: number;
  readonly #secrets: readonly string[];
  readonly #now: () => Date;
  #queue: Queued[] = [];
  #queuedBytes = 0;
  #written: number;
  #dropped = 0;
  #droppedPriority = 0;
  #outSkipped = 0;
  #redacted = 0;
  #truncated = 0;
  #capped = false;
  #closed = false;
  #writing: Promise<void> | null = null;
  #failed = false;

  constructor(file: string, sink: TraceSink, size: number, o: TraceOpenOptions) {
    this.file = file;
    this.#sink = sink;
    this.#written = size;
    this.#fileBound = o.fileBoundBytes ?? TRACE_FILE_BOUND_BYTES;
    this.#hardBound = this.#fileBound * TRACE_FILE_HARD_BOUND_FACTOR;
    this.#recordBound = Math.max(1024, o.recordBoundBytes ?? TRACE_RECORD_BOUND_BYTES);
    this.#qLines = o.queueBoundLines ?? TRACE_QUEUE_BOUND_LINES;
    this.#qBytes = o.queueBoundBytes ?? TRACE_QUEUE_BOUND_BYTES;
    this.#secrets = o.secrets ?? [];
    this.#now = o.now ?? ((): Date => new Date());
    // a resumed file already past the bound starts in skeleton mode
    if (size >= this.#fileBound - CAP_NOTE_ROOM) this.#capped = true;
  }

  /** A raw stdin line as written (its trailing LF is not part of the record). */
  in(raw: string): void {
    this.#record('in', parseLine(raw.replace(/\r?\n$/, '')));
  }

  /** A raw stdout line as received. */
  out(raw: string): void {
    this.#record('out', parseLine(raw));
  }

  ctl(note: Record<string, unknown>): void {
    this.#record('ctl', note);
  }

  /** counts so far (tests, status). */
  stats(): { dropped: number; droppedPriority: number; outSkipped: number; redacted: number; truncated: number; capped: boolean; written: number } {
    return { dropped: this.#dropped, droppedPriority: this.#droppedPriority, outSkipped: this.#outSkipped, redacted: this.#redacted, truncated: this.#truncated, capped: this.#capped, written: this.#written };
  }

  /** Wait for what is queued to reach the disk, at most `deadlineMs`. Resolves true when the queue is empty. */
  async flush(deadlineMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const done = (async (): Promise<boolean> => {
      while (this.#writing) await this.#writing;
      return true;
    })();
    const late = new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), deadlineMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([done, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Flush what is queued, then close the file. Idempotent. */
  async close(): Promise<void> {
    if (this.#closed) return;
    if (this.#outSkipped > 0) this.ctl({ event: 'out-skipped', count: this.#outSkipped });
    if (this.#dropped > 0 || this.#droppedPriority > 0) this.#noteDropped(true);
    if (this.#redacted > 0) this.ctl({ event: 'redacted', count: this.#redacted });
    this.#closed = true;
    while (this.#writing) await this.#writing;
    await this.#sink.close().catch(() => undefined);
  }

  /** A blank separator (a resumed file whose last line was cut off): the reader skips blank lines. */
  separate(): void {
    this.#enqueue({ text: '\n', dir: 'ctl', bytes: 1 }, true);
  }

  #record(dir: TraceDir, line: unknown): void {
    if (this.#closed || this.#failed) return;
    const red = redactValue(line, this.#secrets);
    this.#redacted += red.count;
    let value = red.value;
    if (this.#capped && dir === 'out') value = outSkeleton(value);
    let text = this.#encode(dir, value);
    let bytes = Buffer.byteLength(text);
    if (!this.#capped && this.#committed() + bytes > this.#fileBound - CAP_NOTE_ROOM) {
      this.#capped = true;
      const note = this.#encode('ctl', { event: 'capped', capBytes: this.#fileBound, mode: 'skeleton' });
      this.#enqueue({ text: note, dir: 'ctl', bytes: Buffer.byteLength(note) }, true);
      if (dir === 'out') {
        text = this.#encode(dir, outSkeleton(value));
        bytes = Buffer.byteLength(text);
      }
    }
    if (dir === 'out' && this.#capped && this.#committed() + bytes > this.#hardBound) {
      this.#outSkipped++;
      return;
    }
    if (this.#dropped > 0 || this.#droppedPriority > 0) this.#noteDropped(false);
    this.#enqueue({ text, dir, bytes }, dir !== 'out');
  }

  #noteDropped(force: boolean): void {
    const note = this.#encode('ctl', { event: 'dropped', count: this.#dropped + this.#droppedPriority, ...(this.#droppedPriority ? { priority: this.#droppedPriority } : {}) });
    const bytes = Buffer.byteLength(note);
    // as soon as there is room (never by evicting): a full queue keeps counting until it drains
    if (!force && (this.#queue.length >= this.#qLines || this.#queuedBytes + bytes > this.#qBytes)) return;
    this.#dropped = 0;
    this.#droppedPriority = 0;
    this.#enqueue({ text: note, dir: 'ctl', bytes }, true);
  }

  #committed(): number {
    return this.#written + this.#queuedBytes;
  }

  /** The JSON record line, at most the record bound (a larger one keeps a truncated copy, its hash and size). */
  #encode(dir: TraceDir, line: unknown): string {
    const t = this.#now().toISOString();
    const text = `${JSON.stringify({ t, dir, line })}\n`;
    if (Buffer.byteLength(text) <= this.#recordBound) return text;
    this.#truncated++;
    const body = typeof line === 'string' ? line : JSON.stringify(line);
    const base = { truncated: 'record-cap', ...(typeof field(line, 'type') === 'string' ? { type: shortStr(field(line, 'type')) } : {}), ...(typeof field(line, 'subtype') === 'string' ? { subtype: shortStr(field(line, 'subtype')) } : {}), bytes: Buffer.byteLength(body), hash: `sha256:${sha256(body)}` };
    let keep = Math.floor((this.#recordBound - 512) / 2);
    for (;;) {
      const out = `${JSON.stringify({ t, dir, line: { ...base, head: [...body.slice(0, keep)].join('') } })}\n`;
      if (Buffer.byteLength(out) <= this.#recordBound || keep <= 0) return out;
      keep = Math.floor(keep / 2);
    }
  }

  /** Queue one record. `priority` (in, ctl) evicts queued `out` records and may use a reserve. Returns false when dropped. */
  #enqueue(item: Queued, priority: boolean): boolean {
    if (this.#closed || this.#failed) return false;
    const full = (k: number): boolean => this.#queue.length >= this.#qLines * k || this.#queuedBytes + item.bytes > this.#qBytes * k;
    if (full(1)) {
      if (!priority) {
        this.#dropped++;
        return false;
      }
      for (let i = this.#queue.length - 1; i >= 0 && full(1); i--) {
        if (this.#queue[i]!.dir !== 'out') continue;
        this.#queuedBytes -= this.#queue[i]!.bytes;
        this.#queue.splice(i, 1);
        this.#dropped++;
      }
      if (full(2)) {
        this.#droppedPriority++;
        return false;
      }
    }
    this.#queue.push(item);
    this.#queuedBytes += item.bytes;
    this.#kick();
    return true;
  }

  #kick(): void {
    if (this.#writing || this.#queue.length === 0) return;
    this.#writing = (async () => {
      while (this.#queue.length > 0 && !this.#failed) {
        const batch = this.#queue.splice(0, this.#queue.length);
        const text = batch.map((b) => b.text).join('');
        const bytes = batch.reduce((n, b) => n + b.bytes, 0);
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

function parseLine(raw: string): unknown {
  try {
    const v: unknown = JSON.parse(raw);
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch {
    /* not JSON: kept as the raw string */
  }
  return raw;
}

/**
 * Open the trace stream of one session in a traced project: `<home>/trace/<project key>/<file>`. `projectCwd` is the
 * session cwd (resolved to its realpath here). Throws TraceRefused (`trace-unsafe`: a symlink, a non-regular file,
 * a foreign or non-owner-only dir or file, a key dir of another folder; `trace-unavailable`: cannot create).
 */
export function openTraceStream(home: string, projectCwd: string, hsid: string, o: TraceOpenOptions = {}): TraceStream {
  let real: string;
  try {
    real = fs.realpathSync.native(projectCwd);
  } catch (e) {
    throw new TraceRefused('trace-unavailable', `the project folder does not resolve: ${(e as Error).message}`);
  }
  plainDir(home);
  plainDir(traceRootOf(home));
  const dir = traceDirOf(home, real);
  plainDir(dir);
  claimKeyDir(dir, real);
  const file = path.join(dir, traceFileName(hsid));
  const { fd, size, clean, endsWithLf } = openTraceFile(file);
  const s = new TraceStream(file, (o.sink ?? fdSink)(fd), size, o);
  if (!endsWithLf) s.separate();
  if (!clean) s.ctl({ event: 'prior-close-unclean' });
  return s;
}

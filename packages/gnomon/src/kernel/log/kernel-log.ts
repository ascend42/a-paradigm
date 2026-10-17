/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2, M1.2; research 29 §4 PR-4) — the one hash-chained,
 * append-only, segmented index of everything the kernel does.
 *
 * STORAGE (§3.2 data model). SQLite via `node:sqlite`. The ACTIVE segment is
 * `<home>/kernel.db`; sealed segments live at `<home>/log/segments/NNNNNN.db`.
 * Each segment file holds the spec's `chain` table plus a write-once `meta`
 * table (log id, segment number, base seq, base prev). BEFORE UPDATE/DELETE
 * triggers RAISE(ABORT) on both (L1, G-LOG-02). `seq` is computed inside the
 * write transaction and checked against the in-memory tip (never
 * AUTOINCREMENT). `chain.envelope` stores the exact canonical text that is
 * hashed, so verify recomputes from bytes on disk.
 *
 * SEGMENTS (L5, §9.4; epoch-anchor pattern). A segment closes at `segmentRows`
 * rows (default 10⁶): its LAST row is a `daemon.segment{segment, next,
 * firstSeq, lastSeq}` event, the WAL is checkpointed, the file is fsynced and
 * renamed into `log/segments/`, and a fresh `kernel.db` is created whose base
 * prev is the closing row's hash — the chain runs on unbroken across files.
 * A crash anywhere in rotation is completed on the next open (closing row
 * present ⇒ finish the rename; sealed segment present and no kernel.db ⇒
 * create the next segment iff the anchor agrees).
 *
 * CRASH SAFETY / FSYNC POLICY (stated, measured in test/kernel-log-posix):
 *   - durability 'process-crash' (default): WAL + `synchronous=FULL`, i.e.
 *     every commit fsync(2)s the WAL before append returns. Survives a kill -9
 *     of the daemon and an OS crash on hardware that honours fsync. On macOS
 *     fsync(2) does not flush the drive cache, so a POWER LOSS can drop the
 *     last commits; the anchor then disagrees and open reports it.
 *   - durability 'power-loss': additionally `fullfsync=1` (F_FULLFSYNC per
 *     commit). Measured ~10 ms p50 on an Apple SSD — above the M1.2 5 ms p99
 *     falsifier, so it is opt-in and named, not the default.
 *   - checkpoints: SQLite's inline WAL auto-checkpoint is OFF on the writer
 *     (measured: with it on, ~1 append in 43 paid a ~7.5 ms checkpoint and
 *     p99 over 10⁶ rows was 7.6 ms, tripping the M1.2 falsifier). The log
 *     runs a PASSIVE checkpoint when appends go idle (`checkpointIdleMs`,
 *     unref'd timer) and inline every `checkpointEvery` appends as a hard
 *     WAL bound; close and rotation TRUNCATE-checkpoint. Trade-off stated:
 *     under sustained load the bound costs one longer append per
 *     `checkpointEvery` (visible in `max`, not in p99).
 *   - torn tail: SQLite discards a torn WAL frame on open, so a torn tail
 *     loses only the uncommitted (or, after a lying fsync, the last)
 *     transaction; the anchor check then either accepts a lagging anchor or
 *     reports `INTEGRITY_BROKEN{truncated}` — it never silently forks.
 *
 * ANCHORS (§3.2, G-LOG-06/07) — see anchor.ts. On open: no db but a head
 * anchor, a sealed segment or keys present ⇒ INTEGRITY_BROKEN (missing-db);
 * head ahead of the db ⇒ truncated; head hash ≠ row hash ⇒ anchor-mismatch;
 * head missing on an existing log ⇒ anchor-missing.
 *
 * SIGNATURES (§3.2, §3.1) — see signer.ts and chain.ts. Unsigned rows are
 * accepted only for the diagnostic namespaces; the mandatory list refuses
 * unsigned with reason `unsigned-mandatory` (G-LOG-08).
 *
 * The kernel cannot use the Paradigm logger (zero deps, G-SEC-01); this module
 * reports through return values, refusals and the optional `onDiagnostic`
 * callback, never stdout.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  canonicalJson,
  EVENT_V1,
  defaultLabelsFor,
  INJECT_ORIGINS,
  isPlainObject,
  mintId,
  monotonicUlidFactory,
  SENSITIVITIES,
  validateEventV1,
  type Audience,
  type EventScopeV1,
  type EventV1,
  type KindOwner,
  type Sensitivity,
} from '@a-company/gnomon-contracts';
import { FileAnchorStore, fsyncDir, HEAD_SCHEMA, KeystoreAnchorStore, type AnchorReadResult, type AnchorStore, type HeadAnchor } from './anchor.js';
import {
  assertOwner,
  genesisPrev,
  isSigMandatory,
  logRefusal,
  mayBeUnsigned,
  resolveLabels,
  sha256TaggedFast,
} from './chain.js';
import { projectForReader, type LogView, type ReaderClass } from './redaction.js';
import { KeyRing, SoftwareEd25519Signer, type Signer } from './signer.js';

export const DEFAULT_SEGMENT_ROWS = 1_000_000;
export const SEGMENT_SCHEMA = 'gnomonLogSegment:v1' as const;
export const ACTIVE_DB = 'kernel.db';
export const SEGMENTS_DIR = path.join('log', 'segments');

export type Durability = 'process-crash' | 'power-loss';

export interface KernelLogOptions {
  /** The Gnomon home (`~/.gnomon`), already created 0700 by $daemon-lifecycle. */
  home: string;
  /** The kernel principal `p:<ns>/kernel` — appender of daemon.segment rows. */
  kernelPrincipal: string;
  /** The kernel key. `null` = no key loaded: only diagnostics can be appended. */
  signer: Signer | null;
  /** Public keys for verify; the signer's own key is added automatically. */
  keyRing?: KeyRing;
  segmentRows?: number;
  durability?: Durability;
  /** Keys exist on this machine (M1.3 supplies it): a missing db is then INTEGRITY_BROKEN, never a fresh genesis. */
  keysPresent?: boolean;
  /** Test seam for the keystore anchor (default: the PR-4 stub, `unavailable`). */
  keystoreAnchor?: AnchorStore;
  clock?: () => number;
  /** PASSIVE WAL checkpoint after this many ms without an append (default 250). */
  checkpointIdleMs?: number;
  /** Hard WAL bound: inline PASSIVE checkpoint every N appends (default 20 000). */
  checkpointEvery?: number;
  onDiagnostic?: (d: { what: string; detail: Record<string, unknown> }) => void;
}

export interface AppendInput {
  kind: string;
  principal: string;
  payload?: unknown;
  session?: string;
  connId?: string;
  deviceId?: string;
  idem?: string;
  scope?: EventScopeV1;
  causes?: string[];
  ref?: string;
  refHash?: string;
  /** Tighten only (L6). Omitted = the §9.1 default for the kind. */
  audience?: Audience;
  sensitivity?: Sensitivity;
  /** Which side appends (L7). Default 'kernel'. */
  as?: KindOwner;
  /** Override the signer for this row (e.g. a hardware key later); `null` = unsigned (diagnostics only). */
  signer?: Signer | null;
}

export type AnchorState = 'ok' | 'lagging-repaired' | 'created' | 'unavailable';

export interface OpenReport {
  logId: string;
  created: boolean;
  recoveredRotation: boolean;
  /** Rows the file anchor lagged the db by at open (crash between commit and anchor write). */
  anchorLag: number;
  anchors: { file: AnchorState; keystore: AnchorState };
}

export interface SegmentInfo {
  segment: number;
  file: string;
  baseSeq: number;
  basePrev: string;
  /** baseSeq - 1 when empty. */
  lastSeq: number;
  lastHash: string;
  lastKind: string | null;
  sealed: boolean;
}

export type VerifyFailureCode =
  | 'seq-gap'
  | 'envelope'
  | 'hash'
  | 'prev'
  | 'log'
  | 'column-mismatch'
  | 'sig'
  | 'unknown-key'
  | 'unsigned'
  | 'unregistered-kind'
  | 'label-relaxed'
  | 'meta'
  | 'segment-link'
  | 'segment-unsealed'
  | 'anchor';

export interface VerifyFailure {
  code: VerifyFailureCode;
  segment: number;
  seq?: number;
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  rows: number;
  segments: Array<{ segment: number; firstSeq: number; lastSeq: number; rows: number; ok: boolean }>;
  failures: VerifyFailure[];
  anchors: { file: 'ok' | 'lagging' | 'mismatch' | 'missing' | 'not-checked'; keystore: 'ok' | 'unavailable' | 'mismatch' | 'not-checked' };
}

const SCHEMA_SQL = `
CREATE TABLE chain (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, at TEXT NOT NULL, principal TEXT NOT NULL,
                    audience TEXT NOT NULL, sensitivity TEXT NOT NULL, envelope TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL, sig TEXT);
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TRIGGER chain_no_update BEFORE UPDATE ON chain BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
CREATE TRIGGER chain_no_delete BEFORE DELETE ON chain BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
CREATE TRIGGER meta_no_update BEFORE UPDATE ON meta BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
CREATE TRIGGER meta_no_delete BEFORE DELETE ON meta BEGIN SELECT RAISE(ABORT, 'kernel log is append-only'); END;
`;

interface Meta {
  log: string;
  segment: number;
  baseSeq: number;
  basePrev: string;
}

interface Tip {
  seq: number;
  hash: string;
  kind: string | null;
  at: string;
}

const segName = (n: number): string => `${String(n).padStart(6, '0')}.db`;

function readMeta(db: DatabaseSync): Meta {
  const rows = db.prepare('SELECT k, v FROM meta').all() as Array<{ k: string; v: string }>;
  const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  if (m.schema !== SEGMENT_SCHEMA || !m.log || !m.segment || !m.base_seq || !m.base_prev) {
    throw logRefusal('INTEGRITY_BROKEN', 'segment-broken', 'segment meta missing or malformed');
  }
  return { log: m.log, segment: Number(m.segment), baseSeq: Number(m.base_seq), basePrev: m.base_prev };
}

function readTip(db: DatabaseSync, meta: Meta): Tip {
  const row = db.prepare('SELECT seq, hash, kind, at FROM chain ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string; kind: string; at: string }
    | undefined;
  return row ? { seq: row.seq, hash: row.hash, kind: row.kind, at: row.at } : { seq: meta.baseSeq - 1, hash: meta.basePrev, kind: null, at: '' };
}

function rowToEvent(r: { envelope: string; hash: string; sig: string | null }): EventV1 {
  const e = JSON.parse(r.envelope) as EventV1;
  e.hash = r.hash;
  if (r.sig !== null) e.sig = r.sig;
  return e;
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

/** List sealed segment files, ascending. */
export function listSealedSegments(home: string): Array<{ segment: number; file: string }> {
  const dir = path.join(home, SEGMENTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{6}\.db$/.test(f))
    .map((f) => ({ segment: Number(f.slice(0, 6)), file: path.join(dir, f) }))
    .sort((a, b) => a.segment - b.segment);
}

function segmentInfo(file: string, sealed: boolean): SegmentInfo {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const meta = readMeta(db);
    const tip = readTip(db, meta);
    return { segment: meta.segment, file, baseSeq: meta.baseSeq, basePrev: meta.basePrev, lastSeq: tip.seq, lastHash: tip.hash, lastKind: tip.kind, sealed };
  } finally {
    db.close();
  }
}

export class KernelLog {
  readonly home: string;
  readonly logId: string;
  readonly report: OpenReport;
  readonly #opts: Required<Pick<KernelLogOptions, 'segmentRows' | 'durability' | 'clock'>> & KernelLogOptions;
  readonly #fileAnchor: FileAnchorStore;
  readonly #keystoreAnchor: AnchorStore;
  readonly #keyRing: KeyRing;
  readonly #mono: () => string;
  #db!: DatabaseSync;
  #meta!: Meta;
  #tip!: Tip;
  #insert!: StatementSync;
  #tipStmt!: StatementSync;
  #closed = false;
  #sinceCheckpoint = 0;
  #idleTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(opts: KernelLogOptions) {
    this.#opts = { segmentRows: DEFAULT_SEGMENT_ROWS, durability: 'process-crash', clock: Date.now, ...opts };
    if (!Number.isSafeInteger(this.#opts.segmentRows) || this.#opts.segmentRows < 3) throw new RangeError('segmentRows must be an integer >= 3');
    this.home = opts.home;
    this.#fileAnchor = new FileAnchorStore(opts.home);
    this.#keystoreAnchor = opts.keystoreAnchor ?? new KeystoreAnchorStore();
    this.#keyRing = opts.keyRing ?? new KeyRing();
    if (opts.signer instanceof SoftwareEd25519Signer) this.#keyRing.addEd25519(opts.signer.publicKeyPem);
    this.#mono = monotonicUlidFactory({ clock: this.#opts.clock });
    const r = this.#openOrCreate();
    this.logId = this.#meta.log;
    this.report = { logId: this.logId, ...r };
  }

  /** Open (or, on a machine with no log, no anchor and no keys, create) the kernel log. */
  static open(opts: KernelLogOptions): KernelLog {
    return new KernelLog(opts);
  }

  get activePath(): string {
    return path.join(this.home, ACTIVE_DB);
  }

  get keyRing(): KeyRing {
    return this.#keyRing;
  }

  /** `{log, segment, seq, hash}` of the chain head. */
  head(): { log: string; segment: number; seq: number; hash: string } {
    return { log: this.logId, segment: this.#meta.segment, seq: this.#tip.seq, hash: this.#tip.hash };
  }

  /* ── open / create / recover ────────────────────────────────────────────── */

  #diag(what: string, detail: Record<string, unknown>): void {
    this.#opts.onDiagnostic?.({ what, detail });
  }

  #openOrCreate(): Omit<OpenReport, 'logId'> {
    fs.mkdirSync(path.join(this.home, SEGMENTS_DIR), { recursive: true, mode: 0o700 });
    fs.rmSync(`${this.activePath}.new`, { force: true }); // an interrupted creation never became the log
    const sealed = listSealedSegments(this.home);
    const anchorRead = this.#fileAnchor.read();
    let created = false;
    let recoveredRotation = false;

    if (!fs.existsSync(this.activePath)) {
      const last = sealed.length ? segmentInfo(sealed[sealed.length - 1]!.file, true) : undefined;
      if (last && last.lastKind === 'daemon.segment' && this.#anchorAgrees(anchorRead, last.lastSeq, last.lastHash)) {
        this.#createSegment({ log: this.#metaOf(last.file).log, segment: last.segment + 1, baseSeq: last.lastSeq + 1, basePrev: last.lastHash });
        recoveredRotation = true;
        this.#diag('rotation.recovered', { segment: last.segment + 1 });
      } else if (anchorRead.state !== 'absent' || sealed.length > 0 || this.#opts.keysPresent) {
        throw logRefusal('INTEGRITY_BROKEN', 'missing-db', 'kernel.db is missing but the log existed (anchor, sealed segment or keys present)', {
          anchor: anchorRead.state,
          sealedSegments: sealed.length,
          keysPresent: Boolean(this.#opts.keysPresent),
        });
      } else {
        const ulid = this.#mono();
        const log = mintId('log', ulid);
        this.#createSegment({ log, segment: 1, baseSeq: 1, basePrev: genesisPrev(log) });
        created = true;
      }
    }

    this.#attach();
    const anchors = { file: 'ok' as AnchorState, keystore: 'unavailable' as AnchorState };
    let anchorLag = 0;
    if (created) {
      this.#fileAnchor.write(this.#headAnchor(), true);
      anchors.file = 'created';
    } else {
      // check the anchor against the db as found, BEFORE completing any rotation
      anchorLag = this.#checkAnchor(anchorRead, 'file');
      if (anchorLag > 0) {
        anchors.file = 'lagging-repaired';
        this.#fileAnchor.write(this.#headAnchor(), true);
        this.#diag('anchor.lag.repaired', { lag: anchorLag });
      }
    }
    if (this.#tip.kind === 'daemon.segment') {
      // crashed after the closing row, before the rename: finish the rotation.
      this.#finishRotation();
      recoveredRotation = true;
    }
    const ks = this.#keystoreAnchor.read();
    if (ks.state === 'unavailable') anchors.keystore = 'unavailable';
    else if (ks.state === 'absent' && created) {
      this.#keystoreAnchor.write(this.#headAnchor(), true);
      anchors.keystore = 'created';
    } else anchors.keystore = this.#checkAnchor(ks, 'keystore') > 0 ? 'lagging-repaired' : 'ok';
    return { created, recoveredRotation, anchorLag, anchors };
  }

  #metaOf(file: string): Meta {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      return readMeta(db);
    } finally {
      db.close();
    }
  }

  #anchorAgrees(a: AnchorReadResult, seq: number, hash: string): boolean {
    return a.state === 'present' && a.head.seq === seq && a.head.hash === hash;
  }

  /** Returns the anchor lag (0 = equal); throws INTEGRITY_BROKEN on any disagreement. */
  #checkAnchor(a: AnchorReadResult, which: 'file' | 'keystore'): number {
    if (a.state === 'unavailable') return 0;
    if (a.state === 'absent') throw logRefusal('INTEGRITY_BROKEN', 'anchor-missing', `the ${which} head anchor is missing for an existing log`, { anchor: which });
    if (a.state === 'malformed') throw logRefusal('INTEGRITY_BROKEN', 'anchor-mismatch', `the ${which} head anchor is malformed (${a.why})`, { anchor: which });
    const h = a.head;
    if (h.log !== this.#meta.log) throw logRefusal('INTEGRITY_BROKEN', 'anchor-mismatch', `the ${which} anchor names another log`, { anchor: which });
    if (h.seq > this.#tip.seq) {
      throw logRefusal('INTEGRITY_BROKEN', 'truncated', `the ${which} anchor is at seq ${h.seq} but the log ends at ${this.#tip.seq}`, { anchor: which, anchorSeq: h.seq, tipSeq: this.#tip.seq });
    }
    const hashAt = this.#hashAt(h.seq);
    if (hashAt !== h.hash) throw logRefusal('INTEGRITY_BROKEN', 'anchor-mismatch', `the ${which} anchor hash differs from row ${h.seq}`, { anchor: which, seq: h.seq });
    return this.#tip.seq - h.seq;
  }

  /** Hash of row `seq` (or the genesis/base prev for seq = base-1), searching sealed segments. */
  #hashAt(seq: number): string | undefined {
    if (seq === this.#tip.seq) return this.#tip.hash;
    if (seq === this.#meta.baseSeq - 1) return this.#meta.basePrev;
    if (seq >= this.#meta.baseSeq) return (this.#db.prepare('SELECT hash FROM chain WHERE seq = ?').get(seq) as { hash: string } | undefined)?.hash;
    for (const s of listSealedSegments(this.home)) {
      const info = segmentInfo(s.file, true);
      if (seq === info.baseSeq - 1) return info.basePrev;
      if (seq >= info.baseSeq && seq <= info.lastSeq) {
        const db = new DatabaseSync(s.file, { readOnly: true });
        try {
          return (db.prepare('SELECT hash FROM chain WHERE seq = ?').get(seq) as { hash: string } | undefined)?.hash;
        } finally {
          db.close();
        }
      }
    }
    return undefined;
  }

  /** Create a segment file atomically: build at kernel.db.new, fsync, rename. */
  #createSegment(meta: Meta): void {
    const tmp = `${this.activePath}.new`;
    fs.rmSync(tmp, { force: true });
    const db = new DatabaseSync(tmp);
    try {
      db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      db.exec('BEGIN');
      db.exec(SCHEMA_SQL);
      const put = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
      put.run('schema', SEGMENT_SCHEMA);
      put.run('log', meta.log);
      put.run('segment', String(meta.segment));
      put.run('base_seq', String(meta.baseSeq));
      put.run('base_prev', meta.basePrev);
      db.exec('COMMIT');
    } finally {
      db.close();
    }
    fs.chmodSync(tmp, 0o600);
    const fd = fs.openSync(tmp, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.activePath);
    fsyncDir(this.home);
  }

  #attach(): void {
    this.#db = new DatabaseSync(this.activePath);
    this.#db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA wal_autocheckpoint=0;');
    if (this.#opts.durability === 'power-loss') this.#db.exec('PRAGMA fullfsync=1; PRAGMA checkpoint_fullfsync=1;');
    this.#meta = readMeta(this.#db);
    this.#tip = readTip(this.#db, this.#meta);
    this.#insert = this.#db.prepare(
      'INSERT INTO chain (seq, id, kind, at, principal, audience, sensitivity, envelope, prev_hash, hash, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    this.#tipStmt = this.#db.prepare('SELECT seq, hash FROM chain ORDER BY seq DESC LIMIT 1');
  }

  #headAnchor(): HeadAnchor {
    return { schemaVersion: HEAD_SCHEMA, log: this.#meta.log, segment: this.#meta.segment, seq: this.#tip.seq, hash: this.#tip.hash, at: this.#tip.at };
  }

  #writeAnchors(durable: boolean): void {
    const h = this.#headAnchor();
    this.#fileAnchor.write(h, durable);
    this.#keystoreAnchor.write(h, durable);
  }

  /* ── append ─────────────────────────────────────────────────────────────── */

  /**
   * Append one event. Returns only after the commit is durable per the
   * durability policy — so a caller that must log BEFORE acting (L2,
   * `session.inject` before the child reads, G-LOG-03) sequences on return.
   */
  append(input: AppendInput): EventV1 {
    if (this.#closed) throw logRefusal('ENGINE', 'closed', 'the kernel log is closed');
    if (input.kind === 'daemon.segment') {
      throw logRefusal('FORBIDDEN', 'reserved-kind', 'daemon.segment is written only by the log itself at rotation', { kind: input.kind });
    }
    const e = this.#appendRow(input);
    if (e.seq - this.#meta.baseSeq + 2 >= this.#opts.segmentRows) this.#rotate();
    return e;
  }

  #appendRow(input: AppendInput): EventV1 {
    const kind = input.kind;
    const labels = resolveLabels(kind, input); // refuses unregistered kinds and relaxed labels
    assertOwner(kind, input.as ?? 'kernel');
    const signer = input.signer === undefined ? this.#opts.signer : input.signer;
    if (!signer) {
      if (isSigMandatory(kind)) throw logRefusal('FORBIDDEN', 'unsigned-mandatory', `${kind} must be signed (§3.2)`, { kind });
      if (!mayBeUnsigned(kind)) throw logRefusal('FORBIDDEN', 'unsigned-kind', `${kind} is not a diagnostic and must be signed by its appender's key`, { kind });
    }
    checkPayload(kind, input.payload);

    const seq = this.#tip.seq + 1;
    const ms = this.#opts.clock();
    const env = stripUndefined({
      schemaVersion: EVENT_V1,
      id: mintId('ev', this.#mono()),
      log: this.#meta.log,
      seq,
      at: new Date(ms).toISOString(),
      principal: input.principal,
      keyId: signer?.keyId,
      deviceId: input.deviceId,
      connId: input.connId,
      idem: input.idem,
      session: input.session,
      scope: input.scope,
      audience: labels.audience,
      sensitivity: labels.sensitivity,
      kind,
      causes: input.causes,
      payload: input.payload,
      ref: input.ref,
      refHash: input.refHash,
      prev: this.#tip.hash,
    } as Record<string, unknown>);
    let preimage: string;
    try {
      preimage = canonicalJson(env);
    } catch (err) {
      throw logRefusal('BAD_REQUEST', 'bad-payload', `payload is not canonical-JSON serializable: ${(err as Error).message}`, { kind });
    }
    const hash = sha256TaggedFast(preimage);
    const sig = signer ? Buffer.from(signer.sign('event', hash)).toString('base64') : undefined;
    const event = { ...env, hash, ...(sig !== undefined ? { sig } : {}) } as unknown as EventV1;
    const errors = validateEventV1(event, { checkDefaultLabels: true });
    if (errors.length) throw logRefusal('BAD_REQUEST', 'bad-envelope', errors.join('; '), { kind });

    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.#tipStmt.get() as { seq: number; hash: string } | undefined;
      const curSeq = cur?.seq ?? this.#meta.baseSeq - 1;
      const curHash = cur?.hash ?? this.#meta.basePrev;
      if (curSeq !== this.#tip.seq || curHash !== this.#tip.hash) {
        throw logRefusal('INTEGRITY_BROKEN', 'tip-moved', `chain tip moved under the writer (db ${curSeq}, memory ${this.#tip.seq})`);
      }
      this.#insert.run(seq, event.id, kind, event.at, event.principal, labels.audience, labels.sensitivity, preimage, this.#tip.hash, hash, sig ?? null);
      this.#db.exec('COMMIT');
    } catch (err) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK');
      throw err;
    }
    this.#tip = { seq, hash, kind, at: event.at };
    this.#writeAnchors(false);
    this.#scheduleCheckpoint();
    return event;
  }

  #scheduleCheckpoint(): void {
    if (++this.#sinceCheckpoint >= (this.#opts.checkpointEvery ?? 20_000)) {
      this.checkpoint();
      return;
    }
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      if (!this.#closed) this.checkpoint();
    }, this.#opts.checkpointIdleMs ?? 250);
    this.#idleTimer.unref();
  }

  /** PASSIVE WAL checkpoint (never blocks on readers). */
  checkpoint(): void {
    if (this.#closed) return;
    this.#db.exec('PRAGMA wal_checkpoint(PASSIVE)');
    this.#sinceCheckpoint = 0;
  }

  /* ── segments ───────────────────────────────────────────────────────────── */

  #rotate(): void {
    this.#appendRow({
      kind: 'daemon.segment',
      principal: this.#opts.kernelPrincipal,
      payload: { segment: this.#meta.segment, next: this.#meta.segment + 1, firstSeq: this.#meta.baseSeq, lastSeq: this.#tip.seq + 1 },
    });
    this.#finishRotation();
  }

  /** Seal the active segment (its last row is daemon.segment) and start the next. */
  #finishRotation(): void {
    const sealedMeta = this.#meta;
    const tip = this.#tip;
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.#db.exec('PRAGMA journal_mode=DELETE');
    this.#db.close();
    const fd = fs.openSync(this.activePath, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const dest = path.join(this.home, SEGMENTS_DIR, segName(sealedMeta.segment));
    fs.renameSync(this.activePath, dest);
    fs.rmSync(`${this.activePath}-wal`, { force: true });
    fs.rmSync(`${this.activePath}-shm`, { force: true });
    fsyncDir(path.dirname(dest));
    fsyncDir(this.home);
    this.#createSegment({ log: sealedMeta.log, segment: sealedMeta.segment + 1, baseSeq: tip.seq + 1, basePrev: tip.hash });
    this.#attach();
    this.#tip = { ...this.#tip, at: tip.at };
    this.#writeAnchors(true);
    this.#diag('segment.sealed', { segment: sealedMeta.segment, lastSeq: tip.seq });
  }

  /** Every segment, sealed first, then the active one. */
  segments(): SegmentInfo[] {
    const out = listSealedSegments(this.home).map((s) => segmentInfo(s.file, true));
    out.push({
      segment: this.#meta.segment,
      file: this.activePath,
      baseSeq: this.#meta.baseSeq,
      basePrev: this.#meta.basePrev,
      lastSeq: this.#tip.seq,
      lastHash: this.#tip.hash,
      lastKind: this.#tip.kind,
      sealed: false,
    });
    return out;
  }

  /* ── read (§9.3) ────────────────────────────────────────────────────────── */

  /**
   * Rows in seq order, projected for `reader` (audience/sensitivity, §9.3).
   * Rows the reader may not see are skipped; sensitive-column rows reach
   * redacting readers as `{kind, hsid, at, hash}` stubs.
   */
  *read(opts: { reader: ReaderClass; fromSeq?: number; toSeq?: number; kinds?: readonly string[]; limit?: number }): Generator<LogView> {
    const from = opts.fromSeq ?? 1;
    const to = opts.toSeq ?? Number.MAX_SAFE_INTEGER;
    const kinds = opts.kinds ? new Set(opts.kinds) : undefined;
    let n = 0;
    for (const seg of this.segments()) {
      if (seg.lastSeq < from || seg.baseSeq > to) continue;
      const db = seg.sealed ? new DatabaseSync(seg.file, { readOnly: true }) : this.#db;
      try {
        const it = db.prepare('SELECT envelope, hash, sig, kind FROM chain WHERE seq >= ? AND seq <= ? ORDER BY seq').iterate(from, to) as Iterable<{
          envelope: string;
          hash: string;
          sig: string | null;
          kind: string;
        }>;
        for (const r of it) {
          if (kinds && !kinds.has(r.kind)) continue;
          const v = projectForReader(rowToEvent(r), opts.reader);
          if (!v) continue;
          yield v;
          if (opts.limit !== undefined && ++n >= opts.limit) return;
        }
      } finally {
        if (seg.sealed) db.close();
      }
    }
  }

  /* ── verify ─────────────────────────────────────────────────────────────── */

  /** `gnomon log verify`: the full chain (every segment + both anchors), or one segment. */
  verify(opts: { segment?: number } = {}): VerifyReport {
    return verifyLog(this.home, { keyRing: this.#keyRing, segment: opts.segment, keystoreAnchor: this.#keystoreAnchor });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#writeAnchors(true);
    this.#db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    this.#db.close();
  }
}

/* ── payload checks (G-LOG-03: an inject row must say what was injected) ─── */

function checkPayload(kind: string, payload: unknown): void {
  if (kind === 'session.inject') {
    if (!isPlainObject(payload)) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject needs {origin, hash, bytes}', { kind });
    if (!(INJECT_ORIGINS as readonly unknown[]).includes(payload.origin)) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject origin must be kernel|client|peer', { kind });
    if (typeof payload.hash !== 'string' || !SHA256_TAGGED.test(payload.hash)) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject hash must be sha256:<hex>', { kind });
    if (!Number.isSafeInteger(payload.bytes) || (payload.bytes as number) < 0) throw logRefusal('BAD_REQUEST', 'bad-payload', 'session.inject bytes must be a non-negative integer', { kind });
  }
}

/* ── verify (standalone: the CLI can run it against a home with no daemon) ── */

const SENS = SENSITIVITIES as readonly string[];
const SHA256_TAGGED = /^sha256:[0-9a-f]{64}$/;

export function verifyLog(
  home: string,
  opts: { keyRing: KeyRing; segment?: number; keystoreAnchor?: AnchorStore },
): VerifyReport {
  const failures: VerifyFailure[] = [];
  const fail = (f: VerifyFailure): void => {
    if (failures.length < 1000) failures.push(f);
  };
  const files = listSealedSegments(home).map((s) => ({ ...s, sealed: true }));
  const active = path.join(home, ACTIVE_DB);
  if (fs.existsSync(active)) files.push({ segment: Number.NaN, file: active, sealed: false });
  const report: VerifyReport = { ok: false, rows: 0, segments: [], failures, anchors: { file: 'not-checked', keystore: 'not-checked' } };

  let logId: string | undefined;
  let expect: { seq: number; prev: string; segment: number } | undefined;
  let lastSegment: { seq: number; hash: string } | undefined;
  for (const f of files) {
    const db = new DatabaseSync(f.file, { readOnly: true });
    try {
      let meta: Meta;
      try {
        meta = readMeta(db);
      } catch {
        fail({ code: 'meta', segment: f.segment, detail: `${path.basename(f.file)}: segment meta missing or malformed` });
        continue;
      }
      if (f.sealed && meta.segment !== f.segment) fail({ code: 'meta', segment: f.segment, detail: `file name says segment ${f.segment}, meta says ${meta.segment}` });
      logId ??= meta.log;
      if (meta.log !== logId) fail({ code: 'log', segment: meta.segment, detail: 'segment belongs to another log' });
      const whole = opts.segment === undefined;
      if (whole) {
        if (!expect) {
          if (meta.segment !== 1 || meta.baseSeq !== 1 || meta.basePrev !== genesisPrev(meta.log)) {
            fail({ code: 'segment-link', segment: meta.segment, detail: 'first segment does not start at the genesis prev (segment missing?)' });
          }
        } else if (meta.segment !== expect.segment || meta.baseSeq !== expect.seq || meta.basePrev !== expect.prev) {
          fail({ code: 'segment-link', segment: meta.segment, detail: `segment ${meta.segment} does not continue segment ${expect.segment - 1}` });
        }
      } else if (meta.segment !== opts.segment) continue;

      const r = verifyRows(db, meta, opts.keyRing, fail);
      report.rows += r.rows;
      report.segments.push({ segment: meta.segment, firstSeq: meta.baseSeq, lastSeq: r.lastSeq, rows: r.rows, ok: r.ok });
      if (f.sealed && r.lastKind !== 'daemon.segment') fail({ code: 'segment-unsealed', segment: meta.segment, detail: 'sealed segment does not end with daemon.segment (truncated?)' });
      expect = { seq: r.lastSeq + 1, prev: r.lastHash, segment: meta.segment + 1 };
      lastSegment = { seq: r.lastSeq, hash: r.lastHash };
    } finally {
      db.close();
    }
  }

  if (opts.segment === undefined) {
    if (!fs.existsSync(active)) fail({ code: 'segment-link', segment: Number.NaN, detail: 'kernel.db (active segment) is missing' });
    const fa = new FileAnchorStore(home).read();
    if (fa.state !== 'present') {
      report.anchors.file = 'missing';
      fail({ code: 'anchor', segment: Number.NaN, detail: `file anchor ${fa.state}` });
    } else if (lastSegment) {
      const h = fa.head;
      if (h.log !== logId || h.seq > lastSegment.seq || (h.seq === lastSegment.seq && h.hash !== lastSegment.hash)) {
        report.anchors.file = 'mismatch';
        fail({ code: 'anchor', segment: h.segment, detail: `file anchor seq ${h.seq} does not match the chain tip ${lastSegment.seq}` });
      } else report.anchors.file = h.seq === lastSegment.seq ? 'ok' : 'lagging';
    }
    const ks = (opts.keystoreAnchor ?? new KeystoreAnchorStore()).read();
    if (ks.state === 'unavailable') report.anchors.keystore = 'unavailable';
    else if (ks.state === 'present' && lastSegment && ks.head.seq === lastSegment.seq && ks.head.hash === lastSegment.hash) report.anchors.keystore = 'ok';
    else {
      report.anchors.keystore = 'mismatch';
      fail({ code: 'anchor', segment: Number.NaN, detail: `keystore anchor ${ks.state}` });
    }
  }
  report.ok = failures.length === 0;
  return report;
}

function verifyRows(
  db: DatabaseSync,
  meta: Meta,
  keyRing: KeyRing,
  fail: (f: VerifyFailure) => void,
): { rows: number; lastSeq: number; lastHash: string; lastKind: string | null; ok: boolean } {
  let expectSeq = meta.baseSeq;
  let prev = meta.basePrev;
  let rows = 0;
  let lastKind: string | null = null;
  let ok = true;
  const seg = meta.segment;
  const bad = (code: VerifyFailureCode, seq: number, detail: string): void => {
    ok = false;
    fail({ code, segment: seg, seq, detail });
  };
  const it = db.prepare('SELECT * FROM chain ORDER BY seq').iterate() as Iterable<{
    seq: number;
    id: string;
    kind: string;
    at: string;
    principal: string;
    audience: string;
    sensitivity: string;
    envelope: string;
    prev_hash: string;
    hash: string;
    sig: string | null;
  }>;
  for (const r of it) {
    rows++;
    if (r.seq !== expectSeq) bad('seq-gap', r.seq, `expected seq ${expectSeq}, found ${r.seq}`);
    expectSeq = r.seq + 1;
    lastKind = r.kind;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(r.envelope) as Record<string, unknown>;
      if (canonicalJson(e) !== r.envelope) bad('envelope', r.seq, 'stored envelope is not canonical');
    } catch {
      bad('envelope', r.seq, 'stored envelope is not JSON');
      prev = r.hash;
      continue;
    }
    if (sha256TaggedFast(r.envelope) !== r.hash) bad('hash', r.seq, 'hash does not match the envelope bytes');
    if (e.prev !== prev || r.prev_hash !== prev) bad('prev', r.seq, 'prev does not chain to the previous row');
    if (e.seq !== r.seq) bad('column-mismatch', r.seq, `envelope seq ${String(e.seq)} != row seq`);
    if (e.log !== meta.log) bad('log', r.seq, 'envelope names another log');
    for (const [col, key] of [
      ['id', 'id'],
      ['kind', 'kind'],
      ['at', 'at'],
      ['principal', 'principal'],
      ['audience', 'audience'],
      ['sensitivity', 'sensitivity'],
    ] as const) {
      if (r[col] !== e[key]) bad('column-mismatch', r.seq, `column ${col} differs from the envelope`);
    }
    const d = defaultLabelsFor(r.kind);
    if (!d) bad('unregistered-kind', r.seq, `kind ${r.kind} is not registered`);
    else if (SENS.indexOf(String(e.sensitivity)) < SENS.indexOf(d.sensitivity)) bad('label-relaxed', r.seq, `sensitivity looser than the ${r.kind} default`);
    if (r.sig !== null) {
      const keyId = typeof e.keyId === 'string' ? e.keyId : '';
      const v = keyRing.verify(keyId, 'event', r.hash, Buffer.from(r.sig, 'base64'));
      if (v === 'unknown-key') bad('unknown-key', r.seq, `signature by unknown key ${keyId || '(none)'}`);
      else if (v === 'bad') bad('sig', r.seq, 'signature does not verify');
    } else if (!mayBeUnsigned(r.kind)) bad('unsigned', r.seq, `${r.kind} row is unsigned`);
    prev = r.hash;
  }
  return { rows, lastSeq: expectSeq - 1, lastHash: prev, lastKind, ok };
}

/**
 * @symbol #kernel-log
 *
 * #kernel-log `gnomon log quarantine` (spec §3.2 known gap, §19.1 release
 * gate (a), §A.6; P8-D84, P8-D89; task T-2026-10-17-009(a), Aegis S34-07/08)
 * — the human-run recovery for a log that refuses to open. It moves the WHOLE
 * home aside, intact, as evidence and installs a new home whose log's genesis
 * row is the kernel-signed reserved `daemon.log.quarantined{quarantinedLog,
 * quarantinedHead{seq, hash, segment}, evidencePath, authorizedBy}`. It is
 * never an in-place downgrade: nothing in the old home is opened for writing,
 * changed or deleted, and the new log is a different log (new log id).
 *
 * LAYOUT. For home `<parent>/<base>`: evidence `<parent>/<base>.quarantine-
 * <stamp>` and staging `<evidence>.new` — siblings, so both renames stay on
 * one volume (atomic). Stamps are `YYYYMMDDTHHMMSSZ-<8 hex>`: no `:` or other
 * Windows-reserved character, no trailing dot or space.
 *
 * CRASH SAFETY (each step is a crash point; tests inject a crash at each):
 *   1. read the old log's identity READ-ONLY (db meta + tip, else the newest
 *      sealed segment, else the file anchor) — `nothing-to-quarantine` if none;
 *   2. create the staging dir (0700) and build the new log there (kernel pub,
 *      genesis row, durable anchors), close it;
 *   3. write + fsync `quarantine-journal.json` in staging: staging is now
 *      COMPLETE (a staging dir without a journal is an abandoned partial);
 *   4. rename home → evidence (atomic), fsync the parent;
 *   5. rename staging → home (atomic), fsync the parent.
 * A crash before 4 leaves the old home intact (plus an inert staging dir).
 * A crash between 4 and 5 leaves the evidence and a complete staging dir and
 * no home: `completePendingQuarantine` (run first by every quarantine and by
 * `startDaemon` before it creates a home) finishes step 5, so no process ever
 * starts a fresh unrelated log in the gap. Abandoned staging dirs are reported,
 * never deleted.
 *
 * REFUSALS (in-process, CLI only): FORBIDDEN{daemon-running} while the
 * pidfile names a live daemon; BAD_REQUEST{not-a-home} (missing, symlink or
 * not a directory); BAD_REQUEST{nothing-to-quarantine}; ENGINE{quarantine-
 * pending} when a journal names this home but both the home and the evidence
 * exist; FORBIDDEN{kernel-key-required} without a signer.
 *
 * HUMAN GATE (residual until M1.3): `authorizedBy` is `interactive-confirm` —
 * the CLI demands an interactive TTY and a typed confirmation. A TTY proves no
 * presence: any same-user process that owns a terminal can pass it. Real
 * presence (the signed helper's prompt, a PresenceToken) replaces it at M1.3.
 * Also at M1.3: the keystore anchor item must move with the evidence, or the
 * new log's open will see an anchor naming the quarantined log.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { FileAnchorStore, fsyncDir, fsyncFile } from './anchor.js';
import { logRefusal } from './chain.js';
import { ACTIVE_DB, KernelLog, listSealedSegments, type QuarantinedPayload } from './kernel-log.js';
import { KeyRing, SoftwareEd25519Signer, type Signer } from './signer.js';
import { recordKernelPub } from '../identity/kernel-pub.js';
import { daemonState } from '../lifecycle/pidfile.js';
import { registerSeams } from '../internal-seams.js';

export const QUARANTINE_JOURNAL = 'quarantine-journal.json';
export const QUARANTINE_JOURNAL_SCHEMA = 'gnomonQuarantineJournal:v1' as const;

/** Crash points of the move, in order (the test seam injects a crash after each). */
export const QUARANTINE_STEPS = ['identity-read', 'staging-created', 'staged', 'moved', 'installed'] as const;
export type QuarantineStep = (typeof QUARANTINE_STEPS)[number];

export interface QuarantineOptions {
  /** The Gnomon home to quarantine (absolute). */
  home: string;
  /** The NEW log's kernel key (the genesis row is signed by it; its public half is recorded in the new home). */
  signer: Signer | null;
  /** The kernel principal for the new log (`p:<ns>/kernel`). */
  kernelPrincipal: string;
  /** How the human was proved; only `interactive-confirm` until presence lands (M1.3). */
  authorizedBy: QuarantinedPayload['authorizedBy'];
  /** The daemon socket path, for the liveness check alongside the pidfile. */
  socketPath?: string;
  clock?: () => number;
}

/** The quarantined log as found (read-only). `source` names where the head came from. */
export interface QuarantineIdentity {
  log: string;
  head: { seq: number; hash: string; segment: number };
  source: 'db' | 'segment' | 'anchor';
}

export interface QuarantineReport {
  home: string;
  evidencePath: string;
  quarantined: QuarantineIdentity;
  newLogId: string;
  genesis: { seq: number; hash: string };
  /** Abandoned (incomplete or pre-move) staging dirs left in place. */
  abandoned: string[];
}

export interface PendingQuarantine {
  /** A staging dir installed as the home by this call (a crash between the two renames). */
  completed: string | null;
  /** Staging dirs that never became a home (left in place, never deleted). */
  abandoned: string[];
  /** A journal names this home while the home AND its evidence both exist (something created a home in the gap). */
  conflict: string | null;
}

interface Journal {
  schemaVersion: typeof QUARANTINE_JOURNAL_SCHEMA;
  home: string;
  evidence: string;
  staging: string;
  quarantinedLog: string;
  newLog: string;
  at: string;
}

const WIN_RESERVED = /[<>:"/\\|?*\u0000-\u001f]/;

/** `<base>.quarantine-<YYYYMMDDTHHMMSSZ>-<8 hex>`: valid on every platform (no Windows-reserved character, no trailing dot/space). */
export function evidenceNameFor(base: string, at: Date, rand: string = randomBytes(4).toString('hex')): string {
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const name = `${base}.quarantine-${stamp}-${rand}`;
  if (WIN_RESERVED.test(name) || /[. ]$/.test(name) || name.length > 255) throw new RangeError(`unsafe evidence name ${name}`);
  return name;
}

function stagingPattern(base: string): RegExp {
  return new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.quarantine-[0-9TZ]+-[0-9a-f]+\\.new$`);
}

function readJournal(staging: string): Journal | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(staging, QUARANTINE_JOURNAL), 'utf8')) as Journal;
    return j.schemaVersion === QUARANTINE_JOURNAL_SCHEMA && typeof j.home === 'string' && typeof j.evidence === 'string' ? j : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finish a quarantine interrupted between its two renames (evidence present,
 * home absent, staging complete). Run before anything creates a home.
 */
export function completePendingQuarantine(home: string): PendingQuarantine {
  const h = path.resolve(home);
  const parent = path.dirname(h);
  const out: PendingQuarantine = { completed: null, abandoned: [], conflict: null };
  if (!fs.existsSync(parent)) return out;
  const re = stagingPattern(path.basename(h));
  for (const name of fs.readdirSync(parent).filter((n) => re.test(n)).sort()) {
    const staging = path.join(parent, name);
    const j = readJournal(staging);
    if (!j || path.resolve(j.home) !== h || path.resolve(j.staging) !== staging) {
      out.abandoned.push(staging);
      continue;
    }
    const homeExists = fs.existsSync(h);
    const evidenceExists = fs.existsSync(j.evidence);
    if (!evidenceExists) out.abandoned.push(staging); // crashed before the move: the old home is intact
    else if (!homeExists && !out.completed) {
      fs.renameSync(staging, h);
      fsyncDir(parent);
      out.completed = staging;
    } else out.conflict ??= staging;
  }
  return out;
}

/** The quarantined log's id and head, read without writing anything in the home. */
export function readQuarantineIdentity(home: string): QuarantineIdentity | undefined {
  const fromDb = (file: string, source: 'db' | 'segment'): QuarantineIdentity | undefined => {
    let db: DatabaseSync | undefined;
    try {
      // Evidence must not change: a read-only open of a WAL database creates
      // -wal/-shm files when they are absent (a clean close removed them), so
      // such a db is opened `immutable=1` (nothing created, nothing locked).
      // With a -wal present (an unclean stop) the files already exist and the
      // WAL holds committed rows, so it is read through normally.
      db = fs.existsSync(`${file}-wal`)
        ? new DatabaseSync(file, { readOnly: true })
        : new DatabaseSync(new URL(`${pathToFileURL(file).href}?immutable=1`), { readOnly: true });
      const meta = Object.fromEntries((db.prepare('SELECT k, v FROM meta').all() as Array<{ k: string; v: string }>).map((r) => [r.k, r.v]));
      const tip = db.prepare('SELECT seq, hash FROM chain ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
      if (!meta.log || !meta.segment || !meta.base_seq || !meta.base_prev) return undefined;
      const segment = Number(meta.segment);
      return { log: meta.log, head: tip ? { seq: tip.seq, hash: tip.hash, segment } : { seq: Number(meta.base_seq) - 1, hash: meta.base_prev, segment }, source };
    } catch {
      return undefined; // unreadable read-only (e.g. a WAL without its -shm): fall back
    } finally {
      db?.close();
    }
  };
  const active = path.join(home, ACTIVE_DB);
  const db = fs.existsSync(active) ? fromDb(active, 'db') : undefined;
  if (db) return db;
  const sealed = listSealedSegments(home);
  const seg = sealed.length ? fromDb(sealed[sealed.length - 1]!.file, 'segment') : undefined;
  if (seg) return seg;
  const a = new FileAnchorStore(home).read();
  if (a.state === 'present') return { log: a.head.log, head: { seq: a.head.seq, hash: a.head.hash, segment: a.head.segment }, source: 'anchor' };
  return undefined;
}

function writeJournal(staging: string, j: Journal): void {
  const file = path.join(staging, QUARANTINE_JOURNAL);
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(j)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fsyncFile(file);
  fsyncDir(staging);
}

/** `gnomon log quarantine` (see the header). */
export function quarantineLog(opts: QuarantineOptions): Promise<QuarantineReport> {
  return quarantineLogWith(opts, () => undefined);
}

async function quarantineLogWith(opts: QuarantineOptions, onStep: (step: QuarantineStep, at: { staging?: string; evidence?: string }) => void): Promise<QuarantineReport> {
  if (!path.isAbsolute(opts.home)) throw logRefusal('BAD_REQUEST', 'not-a-home', 'the home must be an absolute path', { home: opts.home });
  const home = path.resolve(opts.home);
  const parent = path.dirname(home);
  const clock = opts.clock ?? Date.now;
  if (!opts.signer) throw logRefusal('FORBIDDEN', 'kernel-key-required', 'the new log genesis (daemon.log.quarantined) must be signed by a kernel key', { kind: 'daemon.log.quarantined' });

  const pending = completePendingQuarantine(home);
  if (pending.conflict) {
    throw logRefusal('ENGINE', 'quarantine-pending', `an interrupted quarantine (${pending.conflict}) names this home, but the home and its evidence both exist; resolve by hand`, { staging: pending.conflict });
  }
  if (pending.completed) {
    throw logRefusal('ENGINE', 'quarantine-pending', `an interrupted quarantine was completed (${pending.completed} installed as the home); nothing else was moved — re-run to quarantine the new home`, { completed: pending.completed });
  }

  let st: fs.Stats;
  try {
    st = fs.lstatSync(home);
  } catch {
    throw logRefusal('BAD_REQUEST', 'not-a-home', `no home at ${home}`, { home });
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw logRefusal('BAD_REQUEST', 'not-a-home', `${home} is not a plain directory`, { home });
  const ds = daemonState(home, opts.socketPath);
  if (ds.state === 'running') {
    throw logRefusal('FORBIDDEN', 'daemon-running', `the daemon is running (pid ${ds.pidfile.pid}); the home cannot be moved under it`, { pid: ds.pidfile.pid });
  }
  const quarantined = readQuarantineIdentity(home);
  if (!quarantined) throw logRefusal('BAD_REQUEST', 'nothing-to-quarantine', `no kernel log (db, sealed segment or head anchor) in ${home}`, { home });
  onStep('identity-read', {});

  let evidence: string;
  do evidence = path.join(parent, evidenceNameFor(path.basename(home), new Date(clock())));
  while (fs.existsSync(evidence) || fs.existsSync(`${evidence}.new`));
  const staging = `${evidence}.new`;
  fs.mkdirSync(staging, { mode: 0o700 });
  fs.chmodSync(staging, 0o700);
  onStep('staging-created', { staging, evidence });

  const keyRing = new KeyRing();
  if (opts.signer instanceof SoftwareEd25519Signer) {
    recordKernelPub(staging, opts.signer.publicKeyPem);
    keyRing.addEd25519(opts.signer.publicKeyPem);
  }
  const payload: QuarantinedPayload = { quarantinedLog: quarantined.log, quarantinedHead: { ...quarantined.head }, evidencePath: evidence, authorizedBy: opts.authorizedBy };
  const log = await KernelLog.createQuarantineSuccessor({ home: staging, kernelPrincipal: opts.kernelPrincipal, signer: opts.signer, keyRing, clock }, payload);
  const head = log.head();
  const newLogId = log.logId;
  const closed = await log.close();
  if (closed.keystore === 'failed') throw logRefusal('ENGINE', 'anchor-failed', `the new log's closing anchor failed: ${closed.error ?? ''}`, { staging });
  writeJournal(staging, { schemaVersion: QUARANTINE_JOURNAL_SCHEMA, home, evidence, staging, quarantinedLog: quarantined.log, newLog: newLogId, at: new Date(clock()).toISOString() });
  onStep('staged', { staging, evidence });

  fs.renameSync(home, evidence);
  fsyncDir(parent);
  onStep('moved', { staging, evidence });
  fs.renameSync(staging, home);
  fsyncDir(parent);
  onStep('installed', { staging, evidence });

  return { home, evidencePath: evidence, quarantined, newLogId, genesis: { seq: head.seq, hash: head.hash }, abandoned: pending.abandoned };
}

registerSeams('quarantine', { quarantineWithSteps: quarantineLogWith });

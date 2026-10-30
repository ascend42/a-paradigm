/**
 * @symbol #kernel-log
 *
 * #kernel-log `gnomon log quarantine` (spec §3.2 known gap, §19.1 release
 * gate (a), §A.6; P8-D84, P8-D89; task T-2026-10-17-009(a), Aegis S34-07/08)
 * — the human-run recovery for a log that refuses to open. It moves the WHOLE
 * home aside, intact, as evidence and installs a new home whose log's genesis
 * row is the kernel-signed reserved `daemon.log.quarantined{quarantinedLog,
 * quarantinedHead{seq, hash, segment}, evidencePath, authorizedBy}`. It is
 * never an in-place downgrade: nothing in the old home is opened, changed or
 * deleted (see LOCK for the one file it touches), and the new log is a
 * different log (new log id).
 *
 * LAYOUT. For home `<parent>/<base>`: evidence `<parent>/<base>.quarantine-
 * <stamp>` and staging `<evidence>.new` — siblings, so both renames stay on
 * one volume (atomic). Stamps are `YYYYMMDDTHHMMSSZ-<8 hex>`: no `:` or other
 * Windows-reserved character, no trailing dot or space.
 *
 * IDENTITY (round 2, Aegis 1 / reviewer 4). Every head source is read — the
 * active db tip, the newest sealed segment tip, the file anchor and (when one
 * exists, and ONLY for the default home: the keystore items are per OS user,
 * not per home, spec §22 OPEN 19) the keystore anchor — and the HIGHEST seq
 * is the quarantined head,
 * so a truncated db (anchor ahead) is never hidden behind the genesis row.
 * Every observed head is reported (and recorded in the journal) with a
 * `disagree` flag. Databases are read from COPIES (kernel.db + -wal, never
 * -shm) in a private scratch dir that is removed afterwards, because even a
 * read-only open of a WAL database writes its -shm. A copy or open that fails
 * is reported as `unreadable` (never silently dropped); ENOSPC refuses
 * ENGINE{no-space}.
 *
 * CRASH SAFETY (each step is a crash point; tests inject a crash at each):
 *   1. take the daemon lock; read the identity;
 *   2. create the staging dir (0700) and build the new log there (kernel pub,
 *      genesis row, durable anchors), close it;
 *   3. write + fsync `quarantine-journal.json` in staging: staging is now
 *      COMPLETE (a staging dir without a valid journal is abandoned);
 *   4. rename home → evidence (atomic), fsync the parent; release the lock
 *      through the evidence path;
 *   5. rename staging → home (atomic), fsync the parent. ENOENT here means
 *      another process (a daemon start) already installed it.
 * A crash before 4 leaves the old home intact (plus an inert staging dir).
 * A crash between 4 and 5 leaves the evidence and a complete staging dir and
 * no home: `completePendingQuarantine` (run first by every quarantine, by the
 * CLI and by `startDaemon` before it creates a home) finishes step 5 — only
 * after cross-checking the journal against the filesystem and the staging
 * log's signed genesis row (round 2, Aegis 2). The journal is unsigned and
 * the staging keys are its own: these checks stop accidents and planted junk,
 * they do NOT authenticate a staging home against a same-user forger (that
 * waits for M1.3's hardware-held kernel key). Anything that does not match is
 * abandoned, never installed. Abandoned staging dirs are reported, never
 * deleted. A step-5 rename that fails EPERM/EBUSY (a Windows race with a
 * concurrent completePendingQuarantine) refuses ENGINE{install-busy}: retry,
 * the pending install will finish.
 *
 * LOCK (round 2, reviewer 5). Steps 1–4 hold the daemon pidfile lock
 * (acquireDaemonLock), so no daemon can start in the home while it is moved.
 * The lock file lands in the evidence with the rename and is released (its
 * own pidfile, nothing else) through the evidence path, so the evidence is
 * byte-identical to the home as found. CRASH WINDOW: a crash between the
 * step-4 rename and that release leaves OUR pidfile (socketPath
 * `<staging>/no-socket`) in the evidence; completePendingQuarantine reports it
 * as `lockResidue` (never deletes it). A STALE pidfile of a dead daemon is
 * removed by the lock acquisition, so it is DELETED from the evidence — its
 * bytes are kept in the journal (`stalePidfile`, base64) first. That is the
 * only change the quarantine ever makes to the old home.
 *
 * REFUSALS (in-process, CLI only): FORBIDDEN{daemon-running};
 * BAD_REQUEST{not-a-home}; BAD_REQUEST{nothing-to-quarantine};
 * ENGINE{quarantine-pending} (a valid journal names this home but the home
 * and the evidence both exist); ENGINE{home-busy} (the step-4 rename failed:
 * EPERM / EBUSY / EACCES, typically a Windows handle); FORBIDDEN{kernel-key-
 * required}. An interrupted install is not a refusal: the report says
 * `outcome: 'completed-pending'`.
 *
 * HUMAN GATE (residual until M1.3): `authorizedBy: 'interactive-confirm'` is
 * NO PROOF OF PRESENCE — the CLI demands an interactive TTY and a typed
 * confirmation, which any same-user process that owns a terminal can pass.
 * Real presence (the signed helper's prompt, a PresenceToken) replaces it at
 * M1.3. Also at M1.3: the keystore anchor item must move with the evidence.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileAnchorStore, fsyncDir, fsyncFile, KeystoreAnchorStore } from './anchor.js';
import { genesisPrev, logRefusal, sha256TaggedFast } from './chain.js';
import { ACTIVE_DB, KernelLog, listSealedSegments, QUARANTINE_GENESIS_KIND, type QuarantinedPayload } from './kernel-log.js';
import { KeyRing, SoftwareEd25519Signer, type Signer } from './signer.js';
import { readKernelPubs, recordKernelPub } from '../identity/kernel-pub.js';
import { currentUid, resolveGnomonHome } from '../lifecycle/home.js';
import { acquireDaemonLock, daemonState, pidPathOf, readPidfile, type DaemonPidfile } from '../lifecycle/pidfile.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { registerSeams } from '../internal-seams.js';

export const QUARANTINE_JOURNAL = 'quarantine-journal.json';
export const QUARANTINE_JOURNAL_SCHEMA = 'gnomonQuarantineJournal:v1' as const;

/** Crash points of the move, in order (the test seam injects a crash after each). */
export const QUARANTINE_STEPS = ['identity-read', 'staging-created', 'staged', 'evidence-renamed', 'moved', 'installed'] as const;
export type QuarantineStep = (typeof QUARANTINE_STEPS)[number];

export interface QuarantineOptions {
  /** The Gnomon home to quarantine (absolute). */
  home: string;
  /** The NEW log's kernel key (the genesis row is signed by it; its public half is recorded in the new home). */
  signer: Signer | null;
  /** The kernel principal for the new log (`p:<ns>/kernel`, from the same root authority as the daemon). */
  kernelPrincipal: string;
  /** How the human was proved; only `interactive-confirm` (no proof of presence) until M1.3. */
  authorizedBy: QuarantinedPayload['authorizedBy'];
  /** The daemon socket path, for the liveness check alongside the pidfile. */
  socketPath?: string;
  clock?: () => number;
}

export type HeadSource = 'db' | 'segment' | 'file-anchor' | 'keystore-anchor';

export interface ObservedHead {
  source: HeadSource;
  log: string;
  seq: number;
  hash: string;
  segment: number;
}

/** The quarantined log as found. `head` is the HIGHEST observed seq; `observed` lists every source. */
export interface QuarantineIdentity {
  log: string;
  head: { seq: number; hash: string; segment: number };
  source: HeadSource;
  observed: ObservedHead[];
  /** The sources disagree (seq, hash or log id): e.g. a truncated db behind its anchor. */
  disagree: boolean;
  /** Sources present but unreadable (copy or open failed) — shown, never silently dropped. */
  unreadable: Array<{ source: 'db' | 'segment'; reason: string }>;
}

export type QuarantineReport =
  | {
      outcome: 'quarantined';
      home: string;
      evidencePath: string;
      evidenceName: string;
      quarantined: QuarantineIdentity;
      newLogId: string;
      genesis: { seq: number; hash: string };
      /** `another-process`: the step-5 rename found staging gone — a daemon start installed it (completePendingQuarantine). */
      installedBy: 'this' | 'another-process';
      /** Abandoned (incomplete, unverifiable or pre-move) staging dirs left in place. */
      abandoned: string[];
    }
  | {
      outcome: 'completed-pending';
      home: string;
      evidencePath: string;
      evidenceName: string;
      newLogId: string;
      staging: string;
      abandoned: string[];
    };

export interface PendingQuarantine {
  /** A staging dir installed as the home by this call (a crash between the two renames). */
  completed: { staging: string; evidence: string; newLog: string } | null;
  /** Staging dirs that never became a home (left in place, never deleted), with why. */
  abandoned: string[];
  /** A valid journal names this home while the home AND its evidence both exist. */
  conflict: string | null;
  /** Our own lock pidfile left in the evidence by a crash between the step-4 rename and its release (reported, never deleted). */
  lockResidue: string | null;
}

interface Journal {
  schemaVersion: typeof QUARANTINE_JOURNAL_SCHEMA;
  home: string;
  evidence: string;
  evidenceName: string;
  staging: string;
  quarantinedLog: string;
  observedHeads: ObservedHead[];
  /** A stale (dead daemon's) pidfile found in the home, base64 — the lock acquisition deletes it from the evidence. */
  stalePidfile?: string;
  newLog: string;
  at: string;
}

/** Test seam (internal test entry only): replace the step-4/5 renames to simulate EPERM etc. */
export interface QuarantineFsOps {
  rename(from: string, to: string): void;
}

const WIN_RESERVED = /[<>:"/\\|?*\u0000-\u001f]/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `<base>.quarantine-<YYYYMMDDTHHMMSSZ>-<8 hex>`: valid on every platform (no Windows-reserved character, no trailing dot/space). */
export function evidenceNameFor(base: string, at: Date, rand: string = randomBytes(4).toString('hex')): string {
  const stamp = at.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  const name = `${base}.quarantine-${stamp}-${rand}`;
  if (WIN_RESERVED.test(name) || /[. ]$/.test(name) || name.length > 255) throw new RangeError(`unsafe evidence name ${name}`);
  return name;
}

const evidencePattern = (base: string) => new RegExp(`^${escapeRe(base)}\\.quarantine-\\d{8}T\\d{6}Z-[0-9a-f]+$`);

function readJournal(staging: string): Journal | undefined {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(staging, QUARANTINE_JOURNAL), 'utf8')) as Journal;
    const str = (v: unknown) => typeof v === 'string' && v.length > 0;
    return j.schemaVersion === QUARANTINE_JOURNAL_SCHEMA && str(j.home) && str(j.evidence) && str(j.staging) && str(j.quarantinedLog) && str(j.newLog) ? j : undefined;
  } catch {
    return undefined;
  }
}

/** A plain directory (no symlink / junction) owned by this uid. */
function plainOwnedDir(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    const uid = currentUid();
    return st.isDirectory() && !st.isSymbolicLink() && (uid === null || st.uid === uid);
  } catch {
    return false;
  }
}

/**
 * Row 1 of `home`'s log, if it is a verified daemon.log.quarantined: segment
 * 1 meta, the row's envelope re-hashed, its prev the genesis prev, its log
 * id the meta's, signed by a key recorded in the home, by the kernel
 * principal (`p:<ns>/kernel`). Rows and chain only — NOT verifyLog, which
 * also reads the per-user keystore anchor: once that is real (M1.3,
 * T-2026-10-18-007) it names the user's live log, never a staging home.
 */
function verifiedQuarantineGenesis(home: string): { log: string; payload: QuarantinedPayload } | undefined {
  const read = withDbCopy(path.join(home, ACTIVE_DB), (db) => {
    const meta = Object.fromEntries((db.prepare('SELECT k, v FROM meta').all() as Array<{ k: string; v: string }>).map((r) => [r.k, r.v]));
    const r = db.prepare('SELECT seq, kind, principal, envelope, hash, sig FROM chain WHERE seq = 1').get() as
      | { seq: number; kind: string; principal: string; envelope: string; hash: string; sig: string | null }
      | undefined;
    return r && meta.log && meta.segment === '1' && meta.base_seq === '1' && meta.base_prev === genesisPrev(meta.log) ? { log: meta.log, ...r } : undefined;
  });
  const row = read?.ok ? read.value : undefined;
  if (!row || row.kind !== QUARANTINE_GENESIS_KIND || !row.sig || !/^p:[^/]+\/kernel$/.test(row.principal)) return undefined;
  if (sha256TaggedFast(row.envelope) !== row.hash) return undefined;
  let env: { log?: unknown; seq?: unknown; kind?: unknown; principal?: unknown; prev?: unknown; keyId?: unknown; payload?: QuarantinedPayload };
  try {
    env = JSON.parse(row.envelope) as typeof env;
  } catch {
    return undefined;
  }
  if (env.log !== row.log || env.seq !== 1 || env.kind !== row.kind || env.principal !== row.principal || env.prev !== genesisPrev(row.log) || typeof env.keyId !== 'string' || !env.payload) return undefined;
  const pubs = readKernelPubs(home);
  if (!pubs.some((k) => k.keyId === env.keyId)) return undefined;
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  return ring.verify(env.keyId, 'event', row.hash, Buffer.from(row.sig, 'base64')) === 'ok' ? { log: row.log, payload: env.payload } : undefined;
}

/** Why a journal-bearing staging dir may NOT be installed (undefined = it may). */
function journalProblem(h: string, staging: string, j: Journal): string | undefined {
  const parent = path.dirname(h);
  if (path.resolve(j.home) !== h) return 'journal names another home';
  if (path.resolve(j.staging) !== staging || staging !== `${path.resolve(j.evidence)}.new`) return 'staging is not <evidence>.new';
  const evidence = path.resolve(j.evidence);
  if (path.dirname(evidence) !== parent || !evidencePattern(path.basename(h)).test(path.basename(evidence))) return 'evidence is not a quarantine sibling of the home';
  if (!plainOwnedDir(staging) || !plainOwnedDir(evidence)) return 'staging or evidence is not a plain directory owned by this user';
  if (readQuarantineIdentity(evidence, { keystore: false })?.log !== j.quarantinedLog) return 'the evidence is not the quarantined log the journal names';
  const g = verifiedQuarantineGenesis(staging);
  if (!g) return 'the staging log has no verified daemon.log.quarantined genesis';
  if (g.log !== j.newLog || g.payload.evidencePath !== evidence || g.payload.quarantinedLog !== j.quarantinedLog) return 'the staging genesis does not match the journal';
  return undefined;
}

/**
 * Finish a quarantine interrupted between its two renames (evidence present,
 * home absent, staging complete and verified). Run before anything creates a home.
 */
export function completePendingQuarantine(home: string): PendingQuarantine {
  const h = path.resolve(home);
  const parent = path.dirname(h);
  const out: PendingQuarantine = { completed: null, abandoned: [], conflict: null, lockResidue: null };
  if (!fs.existsSync(parent)) return out;
  const re = new RegExp(`^${escapeRe(path.basename(h))}\\.quarantine-\\d{8}T\\d{6}Z-[0-9a-f]+\\.new$`);
  for (const name of fs.readdirSync(parent).filter((n) => re.test(n)).sort()) {
    const staging = path.join(parent, name);
    const j = readJournal(staging);
    if (!j || !fs.existsSync(j.evidence)) {
      out.abandoned.push(staging); // no journal (partial), or crashed before the move: the old home is intact
      continue;
    }
    if (journalProblem(h, staging, j) !== undefined) {
      out.abandoned.push(staging); // unsigned journal that does not check out: never installed
      continue;
    }
    if (!fs.existsSync(h) && !out.completed) {
      fs.renameSync(staging, h);
      fsyncDir(parent);
      out.completed = { staging, evidence: path.resolve(j.evidence), newLog: j.newLog };
      const pf = readPidfile(j.evidence);
      if (pf && pf.socketPath === path.join(staging, 'no-socket')) out.lockResidue = pidPathOf(j.evidence);
    } else out.conflict ??= staging;
  }
  return out;
}

type DbRead<T> = { ok: true; value: T | undefined } | { ok: false; reason: string };

const noSpace = (file: string) =>
  logRefusal('ENGINE', 'no-space', `no space to copy ${file} for a read-only look (ENOSPC); nothing was moved`, { file });

/**
 * Copy a db (+ its -wal, never -shm) into a private scratch dir, run `fn` on
 * the copy, remove the copy. `undefined` = no such file; a failed copy or
 * open is `{ok: false, reason}`; ENOSPC throws ENGINE{no-space}.
 */
function withDbCopy<T>(file: string, fn: (db: DatabaseSync) => T | undefined): DbRead<T> | undefined {
  if (!fs.existsSync(file)) return undefined;
  let scratch: string;
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-qread-'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOSPC') throw noSpace(file);
    return { ok: false, reason: `copy failed: ${(err as NodeJS.ErrnoException).code ?? 'error'}` };
  }
  let db: DatabaseSync | undefined;
  try {
    const copy = path.join(scratch, 'copy.db');
    try {
      fs.copyFileSync(file, copy);
      if (fs.existsSync(`${file}-wal`)) fs.copyFileSync(`${file}-wal`, `${copy}-wal`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? 'error';
      if (code === 'ENOSPC') throw noSpace(file);
      return { ok: false, reason: `copy failed: ${code}` };
    }
    try {
      db = new DatabaseSync(copy);
      return { ok: true, value: fn(db) };
    } catch (err) {
      return { ok: false, reason: `unreadable copy: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}` };
    }
  } finally {
    db?.close();
    fs.rmSync(scratch, { recursive: true, force: true }); // our own copy, never the evidence
  }
}

function dbHead(file: string, source: 'db' | 'segment'): DbRead<ObservedHead> | undefined {
  return withDbCopy(file, (db) => {
    const meta = Object.fromEntries((db.prepare('SELECT k, v FROM meta').all() as Array<{ k: string; v: string }>).map((r) => [r.k, r.v]));
    if (!meta.log || !meta.segment || !meta.base_seq || !meta.base_prev) return undefined;
    const tip = db.prepare('SELECT seq, hash FROM chain ORDER BY seq DESC LIMIT 1').get() as { seq: number; hash: string } | undefined;
    const segment = Number(meta.segment);
    return tip ? { source, log: meta.log, seq: tip.seq, hash: tip.hash, segment } : { source, log: meta.log, seq: Number(meta.base_seq) - 1, hash: meta.base_prev, segment };
  });
}

/**
 * The quarantined log's id and head from every source, without writing
 * anything in the home. The keystore anchor is per OS USER, not per home
 * (spec §22 OPEN 19): it is consulted only for the default home (`keystore`
 * defaults to `home` === resolveGnomonHome()) — never for an evidence dir or
 * a non-default --home, where it would speak for a different log.
 */
export function readQuarantineIdentity(home: string, opts: { keystore?: boolean } = {}): QuarantineIdentity | undefined {
  const observed: ObservedHead[] = [];
  const unreadable: QuarantineIdentity['unreadable'] = [];
  const take = (r: DbRead<ObservedHead> | undefined, source: 'db' | 'segment'): void => {
    if (!r) return;
    if (!r.ok) unreadable.push({ source, reason: r.reason });
    else if (r.value) observed.push(r.value);
  };
  take(dbHead(path.join(home, ACTIVE_DB), 'db'), 'db');
  const sealed = listSealedSegments(home);
  if (sealed.length) take(dbHead(sealed[sealed.length - 1]!.file, 'segment'), 'segment');
  const fa = new FileAnchorStore(home).read();
  if (fa.state === 'present') observed.push({ source: 'file-anchor', log: fa.head.log, seq: fa.head.seq, hash: fa.head.hash, segment: fa.head.segment });
  const useKeystore = opts.keystore ?? path.resolve(home) === path.resolve(resolveGnomonHome());
  if (useKeystore) {
    const ks = new KeystoreAnchorStore().read(); // the stub until M1.3 (`unavailable`)
    if (ks.state === 'present') observed.push({ source: 'keystore-anchor', log: ks.head.log, seq: ks.head.seq, hash: ks.head.hash, segment: ks.head.segment });
  }
  if (!observed.length) return undefined;
  const top = observed.reduce((a, b) => (b.seq > a.seq ? b : a)); // ties keep the earlier (db first)
  const disagree = observed.some((o) => o.log !== top.log || o.seq !== top.seq || o.hash !== top.hash);
  return { log: top.log, head: { seq: top.seq, hash: top.hash, segment: top.segment }, source: top.source, observed, disagree, unreadable };
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

/** Release our lock where it now lives (home before step 4, evidence after): our own pidfile only, never a socket. */
function releaseLockAt(dir: string, lock: DaemonPidfile): void {
  const pf = readPidfile(dir);
  if (pf && pf.pid === lock.pid && pf.startedAt === lock.startedAt) {
    try {
      fs.unlinkSync(pidPathOf(dir));
    } catch {
      /* already gone */
    }
  }
}

/** `gnomon log quarantine` (see the header). */
export function quarantineLog(opts: QuarantineOptions): Promise<QuarantineReport> {
  return quarantineLogWith(opts, () => undefined);
}

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

async function quarantineLogWith(
  opts: QuarantineOptions,
  onStep: (step: QuarantineStep, at: { staging?: string; evidence?: string }) => void,
  fsOps: QuarantineFsOps = { rename: (a, b) => fs.renameSync(a, b) },
): Promise<QuarantineReport> {
  if (!path.isAbsolute(opts.home)) throw logRefusal('BAD_REQUEST', 'not-a-home', 'the home must be an absolute path', { home: opts.home });
  const home = path.resolve(opts.home);
  const parent = path.dirname(home);
  const clock = opts.clock ?? Date.now;
  if (!opts.signer) throw logRefusal('FORBIDDEN', 'kernel-key-required', 'the new log genesis (daemon.log.quarantined) must be signed by a kernel key', { kind: 'daemon.log.quarantined' });

  const pending = completePendingQuarantine(home);
  if (pending.conflict) {
    throw logRefusal('ENGINE', 'quarantine-pending', `an interrupted quarantine (${pending.conflict}) names this home, but the home and its evidence both exist`, { staging: pending.conflict });
  }
  if (pending.completed) {
    const c = pending.completed;
    return { outcome: 'completed-pending', home, evidencePath: c.evidence, evidenceName: path.basename(c.evidence), newLogId: c.newLog, staging: c.staging, abandoned: pending.abandoned };
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

  let evidence: string;
  do evidence = path.join(parent, evidenceNameFor(path.basename(home), new Date(clock())));
  while (fs.existsSync(evidence) || fs.existsSync(`${evidence}.new`));
  const staging = `${evidence}.new`;

  // a dead daemon's pidfile is deleted by the lock acquisition: keep its bytes for the journal first
  let stalePidfile: string | undefined;
  if (ds.state === 'stale') {
    try {
      stalePidfile = fs.readFileSync(pidPathOf(home)).toString('base64');
    } catch {
      /* no pidfile (a stale socket only) */
    }
  }
  let lock: DaemonPidfile;
  try {
    // a socket path that cannot exist: the lock must never unlink a socket in the evidence
    lock = acquireDaemonLock(home, process.pid, { socketPath: path.join(staging, 'no-socket') });
  } catch (err) {
    if (err instanceof LifecycleRefusal && err.reason === 'already-running') throw logRefusal('FORBIDDEN', 'daemon-running', err.message.replace(/^gnomond: /, ''), { ...err.detail });
    throw err;
  }
  let lockAt = home;
  try {
    const quarantined = readQuarantineIdentity(home);
    if (!quarantined) throw logRefusal('BAD_REQUEST', 'nothing-to-quarantine', `no kernel log (db, sealed segment or head anchor) in ${home}`, { home });
    onStep('identity-read', {});

    fs.mkdirSync(staging, { mode: 0o700 });
    fs.chmodSync(staging, 0o700);
    onStep('staging-created', { staging, evidence });

    const keyRing = new KeyRing();
    // Aegis S2 H-1 / L-3 (#kernel-custody): the seal moves with the home, so a quarantine never resets it to "unsealed"
    const sealFile = path.join(opts.home, 'keys', 'kernel-custody.json');
    if (fs.existsSync(sealFile)) {
      fs.mkdirSync(path.join(staging, 'keys'), { recursive: true, mode: 0o700 });
      fs.copyFileSync(sealFile, path.join(staging, 'keys', 'kernel-custody.json'));
      fs.chmodSync(path.join(staging, 'keys', 'kernel-custody.json'), 0o600);
    }
    if (opts.signer instanceof SoftwareEd25519Signer) {
      recordKernelPub(staging, opts.signer.publicKeyPem, new Date(), { sealed: false });
      keyRing.addEd25519(opts.signer.publicKeyPem);
    }
    const payload: QuarantinedPayload = { quarantinedLog: quarantined.log, quarantinedHead: { ...quarantined.head }, evidencePath: evidence, authorizedBy: opts.authorizedBy };
    const log = await KernelLog.createQuarantineSuccessor({ home: staging, kernelPrincipal: opts.kernelPrincipal, signer: opts.signer, keyRing, clock }, payload);
    const head = log.head();
    const newLogId = log.logId;
    const closed = await log.close();
    if (closed.keystore === 'failed') throw logRefusal('ENGINE', 'anchor-failed', `the new log's closing anchor failed: ${closed.error ?? ''}`, { staging });
    writeJournal(staging, {
      schemaVersion: QUARANTINE_JOURNAL_SCHEMA,
      home,
      evidence,
      evidenceName: path.basename(evidence),
      staging,
      quarantinedLog: quarantined.log,
      observedHeads: quarantined.observed,
      ...(stalePidfile !== undefined ? { stalePidfile } : {}),
      newLog: newLogId,
      at: new Date(clock()).toISOString(),
    });
    onStep('staged', { staging, evidence });

    try {
      fsOps.rename(home, evidence);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (BUSY.has(code)) {
        throw logRefusal('ENGINE', 'home-busy', `the home could not be moved (${code}): a file in it is open; nothing was moved — the new home waits unused in ${staging}`, { staging, code });
      }
      throw err;
    }
    lockAt = evidence;
    fsyncDir(parent);
    onStep('evidence-renamed', { staging, evidence }); // crash window: our pidfile is in the evidence until the release below
    releaseLockAt(evidence, lock);
    onStep('moved', { staging, evidence });
    let installedBy: 'this' | 'another-process' = 'this';
    try {
      fsOps.rename(staging, home);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (code === 'EPERM' || code === 'EBUSY') {
        throw logRefusal('ENGINE', 'install-busy', `installing the new home failed (${code}), likely a concurrent pending install; retry — the pending install will finish`, { staging, evidence, code });
      }
      if (code !== 'ENOENT' || readQuarantineIdentity(home, { keystore: false })?.log !== newLogId) throw err;
      installedBy = 'another-process'; // a daemon start ran completePendingQuarantine in the gap
    }
    fsyncDir(parent);
    onStep('installed', { staging, evidence });

    return {
      outcome: 'quarantined',
      home,
      evidencePath: evidence,
      evidenceName: path.basename(evidence),
      quarantined,
      newLogId,
      genesis: { seq: head.seq, hash: head.hash },
      installedBy,
      abandoned: pending.abandoned,
    };
  } finally {
    releaseLockAt(lockAt, lock);
  }
}

registerSeams('quarantine', { quarantineWithSteps: quarantineLogWith });

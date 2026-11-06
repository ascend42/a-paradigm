/**
 * #fabric-mirror — the fabric ledger's RECORD in git: Warpline's anti-truncation
 * backstop (soundness audit C-6), off the user's branches. W2 design
 * (supersedes the W1 hidden ref).
 *
 * THE REF IS THE RECORD; `.warpline/fabric.jsonl` IS A CACHE OF IT. Every ledger
 * write is committed to git BEFORE the file changes (mirror-first, I4/L4), with
 * plumbing only — the index, HEAD and the worktree are never touched:
 *
 *   refs/heads/warpline/fabric      the CANONICAL ledger (branch name configurable,
 *                                   fabricMirror.branch). Only the canonical writer
 *                                   advances it; pushed fast-forward only; a real
 *                                   branch, so it has a reflog, `git clone` fetches
 *                                   it and GitHub rulesets protect it (M1, M2, B1).
 *   refs/warpline/writers/<wid>     each worktree's OWN ledger (#fabric-writer),
 *                                   never pushed, reflog forced.
 *   refs/remotes/<r>/warpline/fabric  what `git fetch` brought.
 *
 * Tree format: mirror-tree.ts (`warpline-mirror/1`, 32-strand segments).
 *
 * THE WRITE SECTION (#fabric-lock opens it before the section's fn runs):
 *   1. context via #git-run; `.git` at the root but git fails ⇒ REFUSE (M3, I6).
 *      Root guard: `rev-parse --show-prefix` is empty (no path compare — Windows
 *      case / 8.3 variants pass, I6).
 *   2. mode: ledger still tracked AND (a mirror ref or the config pin exists) ⇒ a
 *      pre-migration checkout: refuse, write nothing (I2). Tracked and none of
 *      those ⇒ legacy layout, today's behaviour (I1). Otherwise mirror mode.
 *   3. coverage against the own ref (cache <git-dir>/warpline/mirror-cache.json):
 *      ledger pickIds a prefix of the ref's (or ledger empty) ⇒ RESTORE from the
 *      ref (fast-forward only, one atomic ledger write + re-derived tips); ledger
 *      holds strands the ref lacks, or the order differs ⇒ REFUSE (C-6, I7).
 *   4. no genesis while history exists (B1, H2): empty after 3 and any history
 *      signal ⇒ adopt (#fabric-adopt) or refuse with the exact fetch command.
 *   5. publish(newBytes): commit + one `update-ref --stdin` transaction moving the
 *      own ref and (canonical only) the branch, both CAS; only then the file.
 *
 * Library code: no console output — callers report.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteSync } from '../warp/durable.js';
import { readSelvage, writeSelvage } from './fabric.js';
import { readRef, writeRef } from './refs.js';
import { readWarplineConfig } from './config.js';
import { gitRun, gitText, GitRunError } from './git-run.js';
import { readWriterId, ensureWriterId, writerRef } from './writer.js';
import {
  buildMirrorTree,
  catFileBatch,
  encodeCommit,
  hashObject,
  readBlobsCapped,
  readCommitShapes,
  segmentLines,
  writeLooseObject,
  zeroOid,
  LEGACY_ENTRY,
  REGISTRY_ENTRY,
  WRITER_ENTRY,
  FORMAT_ENTRY,
  MIRROR_FORMAT,
  SEGMENT_STRANDS,
  type ObjectFormat,
  type MirrorCommitShape,
} from './mirror-tree.js';

/** The ledger path relative to the repo root (also the pre-0.3.0 tracked path). */
export const LEDGER_REL = '.warpline/fabric.jsonl';
export const DEFAULT_MIRROR_BRANCH = 'warpline/fabric';
export const DEFAULT_MIRROR_REMOTE = 'origin';
/** Blob read cap (L3): max(64 MiB, 16 × the local ledger). */
export const MIRROR_READ_CAP_MIN = 64 * 1024 * 1024;

export type MirrorRefusalKind =
  | 'truncation'
  | 'cas'
  | 'malformed'
  | 'pre-migration'
  | 'unavailable'
  | 'genesis-refused'
  | 'outside-section'
  | 'pin-mismatch'
  | 'mirror-chain-truncation'
  | 'canonical-rewound'
  | 'adopt-refused'
  | 'not-applicable';

/** A refusal from the mirror. Nothing was written when one is thrown. */
export class MirrorRefusal extends Error {
  constructor(
    message: string,
    readonly kind: MirrorRefusalKind = 'truncation',
  ) {
    super(message);
    this.name = 'MirrorRefusal';
  }
}

/* ───────────────────────────── ledger parsing (kept from W1) ───────────────────────────── */

/** One well-formed ledger line, kept as its exact bytes. */
export interface LedgerLine {
  pickId: string;
  schemaVersion: number;
  parents: string[];
  stateId: string | null;
  /** the line's bytes, newline excluded — republished verbatim, never re-serialized. */
  raw: Buffer;
}

export interface ParsedLedger {
  lines: LedgerLine[];
  /** physical line numbers (1-based) that did not parse as a strand. */
  malformed: number[];
}

/** Parse ledger bytes line by line (tolerant — malformed lines are reported, not thrown). */
export function parseLedger(bytes: Buffer): ParsedLedger {
  const lines: LedgerLine[] = [];
  const malformed: number[] = [];
  let offset = 0;
  let lineNo = 0;
  while (offset < bytes.length) {
    let nl = bytes.indexOf(0x0a, offset);
    if (nl === -1) nl = bytes.length;
    lineNo++;
    const raw = bytes.subarray(offset, nl);
    offset = nl + 1;
    const text = raw.toString('utf8');
    if (text.trim().length === 0) continue;
    try {
      const s = JSON.parse(text) as { pickId?: unknown; schemaVersion?: unknown; parents?: unknown; stateId?: unknown };
      if (typeof s.pickId !== 'string' || s.pickId.length === 0) {
        malformed.push(lineNo);
        continue;
      }
      lines.push({
        pickId: s.pickId,
        schemaVersion: typeof s.schemaVersion === 'number' ? s.schemaVersion : 1,
        parents: Array.isArray(s.parents) ? s.parents.filter((p): p is string => typeof p === 'string') : [],
        stateId: typeof s.stateId === 'string' ? s.stateId : null,
        raw: Buffer.from(raw),
      });
    } catch {
      malformed.push(lineNo);
    }
  }
  return { lines, malformed };
}

/** Serialize retained lines back to ledger bytes (newline-terminated). */
export function joinLedger(lines: LedgerLine[]): Buffer {
  if (lines.length === 0) return Buffer.alloc(0);
  const parts: Buffer[] = [];
  for (const l of lines) parts.push(l.raw, Buffer.from('\n'));
  return Buffer.concat(parts);
}

/** The ledger's bytes on disk ([] when it has never been written). */
export function readLedgerBytes(root: string): Buffer {
  try {
    return fs.readFileSync(path.join(root, '.warpline', 'fabric.jsonl'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Buffer.alloc(0);
    throw err;
  }
}

/**
 * The append-only rule: `older` must be a PREFIX of `newer` by pickId (same
 * pickIds, same order — a #grade rewrite keeps both but changes bytes). Returns
 * the pickIds of `older` that are not where the rule needs them ([] = holds).
 */
export function appendOnlyViolations(older: Buffer, newer: Buffer): string[] {
  if (older.length === 0) return [];
  if (newer.length >= older.length && newer.subarray(0, older.length).equals(older)) return [];
  const a = parseLedger(older).lines;
  const b = parseLedger(newer).lines;
  const bad: string[] = [];
  for (let i = 0; i < a.length; i++) {
    if (i >= b.length || b[i].pickId !== a[i].pickId) bad.push(a[i].pickId);
  }
  return bad;
}

/** pickIds of `older` absent from `newer` at ANY position (the set rule, for merge parents). */
export function setViolations(older: Buffer, newer: Buffer): string[] {
  const have = new Set(parseLedger(newer).lines.map((l) => l.pickId));
  return parseLedger(older).lines.filter((l) => !have.has(l.pickId)).map((l) => l.pickId);
}

/** Is `a` (by pickId) a prefix of `b`? */
export function isPickIdPrefix(a: LedgerLine[], b: LedgerLine[]): boolean {
  if (a.length > b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].pickId !== b[i].pickId) return false;
  return true;
}

/* ───────────────────────────── context ───────────────────────────── */

export interface MirrorCtx {
  /** the worktree toplevel (== the fabric root). */
  root: string;
  /** absolute per-worktree git dir. */
  gitDir: string;
  /** absolute common dir (objects, refs). */
  commonDir: string;
  /** a linked (`git worktree add`) worktree. */
  linked: boolean;
  objectFormat: ObjectFormat;
}

export interface MirrorConfig {
  branch: string;
  remote: string;
  genesis: string | null;
  autoPush: boolean;
  /**
   * (W2 review 9) the signing-epoch trust anchor, tracked: `signedFrom` = the
   * boundary pickId (null = genesis; undefined = no pin), `keyIds` = the
   * fingerprints adoption accepts from the record's key registry.
   */
  signedFrom?: string | null;
  keyIds?: string[];
  /** .warpline/config.json exists but could not be parsed. */
  corrupt?: boolean;
}

const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
export const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** fabricMirror from .warpline/config.json, with defaults. */
export function mirrorConfig(root: string): MirrorConfig {
  let raw: Partial<MirrorConfig>;
  try {
    raw = (readWarplineConfig(root) as { fabricMirror?: Partial<MirrorConfig> }).fabricMirror ?? {};
  } catch {
    // A corrupt config must not break a seal (config.ts read posture) — but it
    // must not read as "no pin" either: `corrupt` counts as a history signal, so
    // an empty ledger never mints a genesis under an unreadable pin.
    return { branch: DEFAULT_MIRROR_BRANCH, remote: DEFAULT_MIRROR_REMOTE, genesis: null, autoPush: false, corrupt: true };
  }
  const branch = typeof raw.branch === 'string' && BRANCH_NAME.test(raw.branch) && !raw.branch.includes('..') ? raw.branch : DEFAULT_MIRROR_BRANCH;
  const remote = typeof raw.remote === 'string' && REMOTE_NAME.test(raw.remote) ? raw.remote : DEFAULT_MIRROR_REMOTE;
  return {
    branch,
    remote,
    genesis: typeof raw.genesis === 'string' && raw.genesis.length > 0 ? raw.genesis : null,
    autoPush: raw.autoPush === true,
    ...(raw.signedFrom === null || typeof raw.signedFrom === 'string' ? { signedFrom: raw.signedFrom } : {}),
    keyIds: Array.isArray(raw.keyIds) ? raw.keyIds.filter((k): k is string => typeof k === 'string') : [],
  };
}

export const branchRefOf = (cfg: MirrorConfig): string => `refs/heads/${cfg.branch}`;
export const remoteRefOf = (cfg: MirrorConfig, remote: string = cfg.remote): string => `refs/remotes/${remote}/${cfg.branch}`;

function unavailable(root: string, err: unknown): MirrorRefusal {
  const detail = err instanceof Error ? err.message : String(err);
  return new MirrorRefusal(
    `warpline: fabric write refused — ${root} is a git worktree (.git exists) but git could not answer (${detail}). ` +
      `The fabric's anti-truncation record lives in git, so a write without it is refused rather than unprotected ` +
      `(audit C-6). Fix git (PATH / WARPLINE_GIT, safe.directory, a held lock) and retry.`,
    'unavailable',
  );
}

/**
 * The mirror context for `root`, or null when `root` is not the toplevel of a git
 * worktree (no `.git` there). `.git` present but git fails ⇒ THROWS
 * MirrorRefusal('unavailable') — fail closed (M3, I6).
 */
export function gitContext(root: string): MirrorCtx | null {
  const dotGit = path.join(root, '.git');
  if (!fs.existsSync(dotGit)) return null;
  // A bare `.git` DIRECTORY with no HEAD and no objects is not a repository at all
  // (a placeholder) — no record can exist there. Anything more (a gitlink file, a
  // dir with HEAD/objects) that git cannot answer for is a FAILURE, never absence.
  try {
    if (fs.statSync(dotGit).isDirectory() && !fs.existsSync(path.join(dotGit, 'HEAD')) && !fs.existsSync(path.join(dotGit, 'objects'))) {
      return null;
    }
  } catch {
    /* fall through to git */
  }
  let out: string;
  try {
    const r = gitRun(root, ['rev-parse', '--show-prefix', '--absolute-git-dir', '--git-common-dir', '--show-object-format']);
    if (r.status !== 0) throw new Error(r.stderr.trim() || `rev-parse exit ${r.status}`);
    out = r.stdout.toString('utf8');
  } catch (err) {
    throw unavailable(root, err);
  }
  const lines = out.split(/\r?\n/);
  const [prefix, gitDir, commonRaw, fmt] = lines;
  if (gitDir === undefined || commonRaw === undefined || fmt === undefined || !gitDir || !commonRaw) {
    throw unavailable(root, new Error(`unexpected rev-parse output: ${JSON.stringify(out.slice(0, 200))}`));
  }
  if (prefix.trim() !== '') return null; // root is not the toplevel (root guard)
  const commonDir = path.isAbsolute(commonRaw.trim()) ? commonRaw.trim() : path.resolve(root, commonRaw.trim());
  // `--show-object-format` needs git >= 2.25; an older git echoes the flag back
  // verbatim. Then the format is the extensions.objectformat config (absent ⇒ sha1).
  let objectFormat: ObjectFormat;
  const f = fmt.trim();
  if (f === 'sha1' || f === 'sha256') objectFormat = f;
  else {
    const c = gitRun(root, ['config', '--get', 'extensions.objectformat']);
    objectFormat = c.stdout.toString('utf8').trim() === 'sha256' ? 'sha256' : 'sha1';
  }
  // linked worktree ⇔ its git dir carries a `commondir` file (no path comparison:
  // symlinked / case-variant roots must not flip the answer)
  const linked = fs.existsSync(path.join(gitDir.trim(), 'commondir'));
  return { root, gitDir: gitDir.trim(), commonDir, linked, objectFormat };
}

/** Wrap a git failure in a mirror-unavailable refusal (git errors are never "absent"). */
export function guardGit<T>(ctx: MirrorCtx, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof MirrorRefusal) throw err;
    if (err instanceof GitRunError) throw unavailable(ctx.root, err);
    throw err;
  }
}

export interface MirrorRefs {
  own: string | null;
  branch: string | null;
  remote: string | null;
}

/** Resolve the own ref, the canonical branch and its remote-tracking ref in ONE spawn. */
export function readMirrorRefs(ctx: MirrorCtx, wid: string | null, cfg: MirrorConfig): MirrorRefs {
  const want = new Map<string, keyof MirrorRefs>();
  if (wid) want.set(writerRef(wid), 'own');
  want.set(branchRefOf(cfg), 'branch');
  want.set(remoteRefOf(cfg), 'remote');
  const out = gitText(ctx.root, ['for-each-ref', '--format=%(objectname) %(refname)', ...want.keys()]);
  const refs: MirrorRefs = { own: null, branch: null, remote: null };
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40,64}) (.+)$/.exec(line.trim());
    if (!m) continue;
    const slot = want.get(m[2]);
    if (slot) refs[slot] = m[1];
  }
  return refs;
}

/** Is the ledger path tracked in this worktree's index (the pre-0.3.0 layout)? */
export function ledgerTracked(ctx: MirrorCtx, rel: string = LEDGER_REL): boolean {
  return gitText(ctx.root, ['ls-files', '-z', '--', rel]).length > 0;
}

/** Does any worktree have `branchRef` checked out? Reads HEAD files under the common dir directly. */
export function branchCheckedOut(ctx: MirrorCtx, branchRef: string): boolean {
  const heads = [path.join(ctx.commonDir, 'HEAD')];
  try {
    for (const w of fs.readdirSync(path.join(ctx.commonDir, 'worktrees'))) heads.push(path.join(ctx.commonDir, 'worktrees', w, 'HEAD'));
  } catch {
    /* no linked worktrees */
  }
  for (const h of heads) {
    try {
      if (fs.readFileSync(h, 'utf8').trim() === `ref: ${branchRef}`) return true;
    } catch {
      /* a worktree mid-removal */
    }
  }
  return false;
}

export function isAncestor(ctx: MirrorCtx, a: string, b: string): boolean {
  if (a === b) return true;
  const r = gitRun(ctx.root, ['merge-base', '--is-ancestor', a, b]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw unavailable(ctx.root, new Error(r.stderr.trim()));
}

/* ───────────────────────────── snapshots ───────────────────────────── */

export interface MirrorSnapshot {
  commit: string;
  parents: string[];
  bytes: Buffer;
  writer: string | null;
  format: string | null;
  legacy: Buffer | null;
  /** the record's public key registry (keys-registry.jsonl), or null. */
  registry: Buffer | null;
  segments: string[];
}

export function readCap(localLedgerBytes: number): number {
  return Math.max(MIRROR_READ_CAP_MIN, 16 * localLedgerBytes);
}

/** Read one or more mirror commits fully (segments joined), size-capped (L3). */
export function readSnapshots(ctx: MirrorCtx, commits: string[], cap: number): Map<string, MirrorSnapshot> {
  const shapes = readCommitShapes(ctx.root, ctx.objectFormat, commits);
  const oids: string[] = [];
  for (const s of new Set(shapes.values())) {
    oids.push(...s.segments);
    for (const k of [WRITER_ENTRY, FORMAT_ENTRY, LEGACY_ENTRY, REGISTRY_ENTRY]) {
      const o = s.entries.get(k);
      if (o) oids.push(o);
    }
  }
  const blobs = readBlobsCapped(ctx.root, oids, cap);
  const out = new Map<string, MirrorSnapshot>();
  for (const c of commits) {
    const s = shapes.get(c) as MirrorCommitShape;
    const get = (k: string): Buffer | null => {
      const o = s.entries.get(k);
      return o ? (blobs.get(o) ?? null) : null;
    };
    out.set(c, {
      commit: s.commit,
      parents: s.parents,
      bytes: Buffer.concat(s.segments.map((o) => blobs.get(o) as Buffer)),
      writer: get(WRITER_ENTRY)?.toString('utf8').trim() ?? null,
      format: get(FORMAT_ENTRY)?.toString('utf8').trim() ?? null,
      legacy: get(LEGACY_ENTRY),
      registry: get(REGISTRY_ENTRY),
      segments: s.segments,
    });
  }
  return out;
}

export function readSnapshot(ctx: MirrorCtx, commit: string, cap: number = readCap(0)): MirrorSnapshot {
  const snap = readSnapshots(ctx, [commit], cap).get(commit) as MirrorSnapshot;
  if (snap.format !== null && snap.format !== MIRROR_FORMAT) {
    throw new MirrorRefusal(`warpline: mirror commit ${commit} has unknown format "${snap.format}"`, 'malformed');
  }
  return snap;
}

/** The writer id recorded in a mirror commit (one spawn). */
export function writerOf(ctx: MirrorCtx, commit: string): string | null {
  const [o] = catFileBatch(ctx.root, [`${commit}:${WRITER_ENTRY}`]);
  return o?.body ? o.body.toString('utf8').trim() : null;
}

/* ───────────────────────────── cache ───────────────────────────── */

interface MirrorCache {
  commit: string;
  size: number;
  sha256: string;
  segments: string[];
  writers?: Record<string, string>;
  /** this worktree advanced the canonical branch at least once (a later missing branch is a deletion). */
  wasCanonical?: boolean;
}

const cachePath = (ctx: MirrorCtx): string => path.join(ctx.gitDir, 'warpline', 'mirror-cache.json');
const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

function readCache(ctx: MirrorCtx): MirrorCache | null {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(ctx), 'utf8')) as MirrorCache;
    return typeof c.commit === 'string' && Array.isArray(c.segments) ? c : null;
  } catch {
    return null;
  }
}

/** The cached own-record commit + canonical flag (verify's rewind check). */
export function readMirrorCacheCommit(ctx: MirrorCtx): { commit: string; wasCanonical: boolean } | null {
  const c = readCache(ctx);
  return c ? { commit: c.commit, wasCanonical: c.wasCanonical === true } : null;
}

function writeCache(ctx: MirrorCtx, c: MirrorCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath(ctx)), { recursive: true });
    atomicWriteSync(cachePath(ctx), JSON.stringify(c) + '\n');
  } catch {
    /* the cache is an optimisation — a miss re-reads the blob */
  }
}

/* ───────────────────────────── audit cursor ───────────────────────────── */

const cursorPath = (ctx: MirrorCtx): string => path.join(ctx.commonDir, 'warpline', 'audit.json');

export function readAuditCursor(ctx: MirrorCtx): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(cursorPath(ctx), 'utf8')) as { refs?: Record<string, string> };
    return raw.refs ?? {};
  } catch {
    return {};
  }
}

export function advanceAuditCursor(ctx: MirrorCtx, ref: string, commit: string): void {
  const refs = readAuditCursor(ctx);
  refs[ref] = commit;
  fs.mkdirSync(path.dirname(cursorPath(ctx)), { recursive: true });
  atomicWriteSync(cursorPath(ctx), JSON.stringify({ refs }, null, 2) + '\n');
}

/* ───────────────────────────── events (signals) ───────────────────────────── */

export type MirrorSignal = '!fabric-adopted' | '!mirror-chain-truncation' | '!canonical-rewound';

/**
 * Emit a #fabric-mirror signal: one JSON line in <common-dir>/warpline/events.jsonl
 * and one line in the hook log (where the background auto-seal's output lands), so
 * an adoption or an audit failure is visible after the fact. Best-effort.
 */
export function emitMirrorSignal(ctx: MirrorCtx, signal: MirrorSignal, detail: Record<string, unknown>): void {
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(path.join(ctx.commonDir, 'warpline'), { recursive: true });
    fs.appendFileSync(path.join(ctx.commonDir, 'warpline', 'events.jsonl'), JSON.stringify({ signal, at, ...detail }) + '\n');
    fs.appendFileSync(path.join(ctx.commonDir, 'warpline-hook.log'), `    ${signal} ${JSON.stringify(detail)}\n`);
  } catch {
    /* signals never break a write */
  }
}

/* ───────────────────────────── tips ───────────────────────────── */

/**
 * Re-derive the tip pointers after the ledger moved forward from `oldLines` to
 * `newLines` (restore / adopt). The next v2 seal chains off the physical tip, so
 * a LINEAR new tip moves both pointers; a v3 tip leaves the per-clone refs alone.
 * Refuses (before any write) when the current pointers name a strand the new
 * ledger does not carry. Returns the apply step.
 */
export function planTips(wdir: string, newLines: LedgerLine[]): () => void {
  const newTip = newLines[newLines.length - 1];
  if (newTip === undefined || newTip.schemaVersion >= 3) return () => undefined;
  const curSelvage = readSelvage(wdir);
  const curRef = readRef(wdir, 'selvage');
  const okSelvage = curSelvage === null || newLines.some((l) => l.stateId === curSelvage);
  const okRef = curRef === null || newLines.some((l) => l.pickId === curRef);
  if (!okSelvage || !okRef) {
    throw new MirrorRefusal(
      `warpline: refused — the local tip pointers (selvage ${curSelvage ?? '(none)'}, refs/heads/selvage ` +
        `${curRef ?? '(none)'}) name a strand the recorded ledger does not carry, so they cannot be moved forward ` +
        `safely. Nothing was written; run \`warpline fabric verify\`.`,
      'truncation',
    );
  }
  return () => {
    if (newTip.stateId !== null && curSelvage !== newTip.stateId) writeSelvage(wdir, newTip.stateId, curSelvage);
    if (curRef !== newTip.pickId) writeRef(wdir, 'selvage', newTip.pickId, curRef);
  };
}

/* ───────────────────────────── the section ───────────────────────────── */

export interface FabricSection {
  root: string;
  wdir: string;
  ctx: MirrorCtx;
  cfg: MirrorConfig;
  wid: string;
  ownRef: string;
  branchRef: string;
  ownCommit: string | null;
  branchTip: string | null;
  remoteTip: string | null;
  /** the ledger bytes the own ref holds (== the file once the section is open). */
  bytes: Buffer;
  segOids: string[];
  /** this worktree may advance the canonical branch. */
  canonical: boolean;
  /** no canonical branch anywhere and this is the main worktree: the first publish creates it. */
  createBranch: boolean;
  branchCheckedOut: boolean;
  /** strands restored from the own ref at open. */
  restored: number;
  /** the ledger is empty and history exists: #fabric-adopt must run before any write. */
  needsAdopt: string | null;
  /** own ref missing and the ledger extends the canonical record: the first publish takes it as a parent. */
  parentHint: string | null;
  published: number;
  closed: boolean;
}

export type SectionMode =
  | { mode: 'none' }
  | { mode: 'legacy'; ctx: MirrorCtx }
  | { mode: 'mirror'; section: FabricSection };

function truncationRefusal(root: string, ownRef: string, detail: string): MirrorRefusal {
  return new MirrorRefusal(
    `warpline: fabric write refused — the ledger ${root}/.warpline/fabric.jsonl does not match its record ` +
      `${ownRef}: ${detail}. The ref is the record and the ledger only grows by appending, so this is TRUNCATION or ` +
      `an out-of-band edit (audit C-6). Nothing was written. Inspect with \`warpline mirror status\`; the record ` +
      `restores itself onto an empty or shorter ledger, so moving the edited file aside fixes it.`,
    'truncation',
  );
}

/** Does any signal say this repository already HAS fabric history (B1, H2)? */
export function historySignal(ctx: MirrorCtx, cfg: MirrorConfig, refs: MirrorRefs): string | null {
  if (refs.branch) return branchRefOf(cfg);
  if (refs.remote) return remoteRefOf(cfg);
  if (cfg.genesis) return `the pinned genesis ${cfg.genesis} (.warpline/config.json fabricMirror.genesis)`;
  if (cfg.corrupt) return 'an unreadable .warpline/config.json (its genesis pin cannot be checked)';
  const head = gitRun(ctx.root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head.status !== 0) return null; // unborn branch: no history at all
  const c = gitText(ctx.root, ['log', '-1', '--format=%H', '--', LEDGER_REL]);
  return c ? `commit ${c.slice(0, 12)} (it tracked ${LEDGER_REL})` : null;
}

/**
 * Open the write section for `root` (steps 1-4 of the module header). Restores
 * the ledger from the own ref when it is a strict prefix of it. Throws a
 * MirrorRefusal when the write must not happen.
 */
export function openSection(root: string, opts: { ignoreTracked?: boolean } = {}): SectionMode {
  const ctx = gitContext(root);
  if (ctx === null) return { mode: 'none' };
  return guardGit(ctx, () => {
    const cfg = mirrorConfig(root);
    const existingWid = readWriterId(ctx.gitDir);
    const refs = readMirrorRefs(ctx, existingWid, cfg);
    const tracked = ledgerTracked(ctx);
    if (tracked && !opts.ignoreTracked) {
      if (refs.own || refs.branch || refs.remote || cfg.genesis) {
        if (!refs.own && !refs.branch && !cfg.genesis) {
          throw new MirrorRefusal(
            `warpline: fabric write refused — upstream migrated: ${remoteRefOf(cfg)} exists but this checkout still ` +
              `TRACKS ${LEDGER_REL}. Sealing here would grow a second history. Nothing was written; run ` +
              `\`warpline mirror migrate\` before pulling (it follows the upstream record, or forks).`,
            'pre-migration',
          );
        }
        throw new MirrorRefusal(
          `warpline: fabric write refused — this checkout still TRACKS ${LEDGER_REL} (a commit from before ` +
            `\`warpline mirror migrate\`: bisect, an old branch) but the repository's fabric lives in ` +
            `${refs.own ? writerRef(existingWid as string) : branchRefOf(cfg)}. Writing here would fork the record. ` +
            `Nothing was written; check out a migrated commit (e.g. main) and the next write restores the ledger.`,
          'pre-migration',
        );
      }
      return { mode: 'legacy', ctx };
    }

    const wid = ensureWriterId(ctx.gitDir);
    const ownRef = writerRef(wid);
    const wdir = path.join(root, '.warpline');
    const ledger = readLedgerBytes(root);
    const parsed = parseLedger(ledger);
    let bytes = ledger;
    let segOids: string[] = [];
    let restored = 0;

    // (W2 review item 1) the OWN record may never move backwards or vanish out of band.
    const cache0 = readCache(ctx);
    if (cache0 && cache0.commit !== refs.own) {
      const ok = refs.own !== null && gitRun(ctx.root, ['merge-base', '--is-ancestor', cache0.commit, refs.own]).status === 0;
      if (!ok) {
        throw truncationRefusal(
          root,
          ownRef,
          `the own record moved from ${cache0.commit.slice(0, 12)} to ${refs.own?.slice(0, 12) ?? '(deleted)'} out of ` +
            `band, which is not a fast-forward (rewound or deleted; see \`git reflog ${ownRef}\`)`,
        );
      }
    }
    let branchWriter: string | null = null;
    if (refs.branch) {
      // (final N4) the safety check never trusts the cached writer: one cat-file, always
      branchWriter = writerOf(ctx, refs.branch);
      if (!ctx.linked && branchWriter === wid && (refs.own === null || !isAncestor(ctx, refs.branch, refs.own))) {
        throw truncationRefusal(
          root,
          ownRef,
          `this worktree wrote the canonical branch ${branchRefOf(cfg)} (${refs.branch.slice(0, 12)}) but its own record ` +
            `is ${refs.own ? 'behind it' : 'missing'} — the own ref was rewound or deleted`,
        );
      }
    }
    let parentHint: string | null = null;
    let adoptHint: string | null = null;
    const canonTip = refs.branch ?? refs.remote;
    if (!refs.own && parsed.lines.length > 0 && canonTip !== null) {
      const canon = parseLedger(readSnapshot(ctx, canonTip, readCap(ledger.length)).bytes).lines;
      if (isPickIdPrefix(parsed.lines, canon)) adoptHint = `the canonical record ${canonTip.slice(0, 12)} (the ledger is a prefix of it)`;
      else if (isPickIdPrefix(canon, parsed.lines)) parentHint = canonTip;
    }

    if (refs.own) {
      const cache = readCache(ctx);
      if (cache && cache.commit === refs.own && cache.size === ledger.length && cache.sha256 === sha256(ledger)) {
        segOids = cache.segments;
      } else {
        const snap = readSnapshot(ctx, refs.own, readCap(ledger.length));
        const recorded = parseLedger(snap.bytes).lines;
        const good = parsed.lines;
        if (!snap.bytes.equals(ledger)) {
          if (!isPickIdPrefix(good, recorded)) {
            const i = good.findIndex((l, k) => k >= recorded.length || recorded[k].pickId !== l.pickId);
            throw truncationRefusal(
              root,
              ownRef,
              i >= recorded.length
                ? `the ledger holds ${good.length - recorded.length} strand(s) the record lacks (first: ${good[recorded.length]?.pickId})`
                : `strand ${i} is ${good[i]?.pickId} in the ledger but ${recorded[i]?.pickId} in the record (order differs)`,
            );
          }
          // strict prefix (or empty / torn tail / same ids, older bytes) ⇒ restore, fast-forward only
          const applyTips = planTips(wdir, recorded);
          fs.mkdirSync(wdir, { recursive: true });
          if (parsed.malformed.length > 0) {
            // (item 17) quarantine the torn bytes before the restore drops them
            const q = path.join(wdir, 'repair', `restore-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl.bak`);
            fs.mkdirSync(path.dirname(q), { recursive: true });
            atomicWriteSync(q, ledger);
          }
          atomicWriteSync(path.join(wdir, 'fabric.jsonl'), snap.bytes);
          applyTips();
          restored = recorded.length - good.length;
          bytes = snap.bytes;
        }
        segOids = snap.segments;
        writeCache(ctx, { commit: refs.own, size: bytes.length, sha256: sha256(bytes), segments: segOids });
      }
    } else if (parsed.malformed.length > 0) {
      // no record yet and a torn ledger: let the section open (repair runs in it);
      // publish refuses malformed bytes.
    }

    const lines = parseLedger(bytes).lines;
    if (cfg.genesis && lines.length > 0 && lines[0].pickId !== cfg.genesis) {
      throw new MirrorRefusal(
        `warpline: fabric write refused — the ledger's first strand ${lines[0].pickId} is not this repository's ` +
          `pinned genesis ${cfg.genesis} (.warpline/config.json fabricMirror.genesis): it is a different history. ` +
          `Nothing was written.`,
        'pin-mismatch',
      );
    }
    let needsAdopt: string | null = adoptHint;
    if (lines.length === 0) needsAdopt = historySignal(ctx, cfg, refs);

    const branchRef = branchRefOf(cfg);
    let canonical = false;
    if (!ctx.linked && refs.branch && refs.own) {
      const cache = readCache(ctx);
      if (cache && branchWriter && !cache.writers?.[refs.branch]) writeCache(ctx, { ...cache, writers: { [refs.branch]: branchWriter } });
      canonical = branchWriter === wid && isAncestor(ctx, refs.branch, refs.own);
    }
    const createBranch =
      !ctx.linked && !cfg.corrupt && refs.branch === null && refs.remote === null && needsAdopt === null && !cache0?.wasCanonical;
    return {
      mode: 'mirror',
      section: {
        root,
        wdir,
        ctx,
        cfg,
        wid,
        ownRef,
        branchRef,
        ownCommit: refs.own,
        branchTip: refs.branch,
        remoteTip: refs.remote,
        bytes,
        segOids,
        canonical,
        createBranch,
        branchCheckedOut: branchCheckedOut(ctx, branchRef),
        restored,
        needsAdopt,
        parentHint,
        published: 0,
        closed: false,
      },
    };
  });
}

/* ───────────────────────────── publish ───────────────────────────── */

/**
 * (final N2) The key registry a publish records: the previous record's registry
 * (own commit, else the parent hint / first extra parent) with the local rows
 * appended. The local registry must be a BYTE EXTENSION of the recorded one —
 * a shrunk or replaced registry would un-sign history, so it refuses.
 */
export function registryToRecord(section: FabricSection, opts: PublishOptions = {}, regPath = path.join(section.wdir, 'keys', 'registry.jsonl')): Buffer | null {
  const from = section.ownCommit ?? section.parentHint ?? opts.extraParents?.[0] ?? opts.adoptCommit ?? null;
  const prev = from !== null ? (catFileBatch(section.ctx.root, [`${from}:${REGISTRY_ENTRY}`])[0]?.body ?? null) : null;
  const local = opts.registry !== undefined ? opts.registry : fs.existsSync(regPath) ? fs.readFileSync(regPath) : null;
  if (local === null) return prev;
  if (prev === null) return local;
  if (local.length >= prev.length && local.subarray(0, prev.length).equals(prev)) return local;
  if (prev.length > local.length && prev.subarray(0, local.length).equals(local)) {
    throw new MirrorRefusal(
      `warpline: fabric write refused — the local key registry (${regPath}) is SHORTER than the recorded one: ` +
        `recording it would drop key rows (un-signing history). Nothing was written; restore the registry.`,
      'truncation',
    );
  }
  throw new MirrorRefusal(
    `warpline: fabric write refused — the local key registry (${regPath}) is not an append-only extension of the ` +
      `recorded registry (a replaced registry would re-key history). Nothing was written.`,
    'truncation',
  );
}

export interface PublishOptions {
  message?: string;
  /** extra commit parents (an adopted / unioned incoming commit). */
  extraParents?: string[];
  /** the record commit to land the own ref on without writing a new commit (an exact fast-forward). */
  adoptCommit?: string;
  /** the fabric-legacy.json bytes to record (default: the local file) — adoption records the INCOMING manifest. */
  legacy?: Buffer | null;
  /** the public key registry to record (default: .warpline/keys/registry.jsonl). */
  registry?: Buffer | null;
}

/** Commit `newBytes` as the next record and move the refs (one CAS transaction). The FILE is the caller's next step. */
export function publish(section: FabricSection, newBytes: Buffer, opts: PublishOptions = {}): string {
  if (section.closed) throw new MirrorRefusal('warpline: publish on a closed fabric section', 'outside-section');
  const { ctx } = section;
  return guardGit(ctx, () => {
    const parsed = parseLedger(newBytes);
    if (parsed.malformed.length > 0) {
      throw new MirrorRefusal(
        `warpline: fabric write refused — the new ledger has ${parsed.malformed.length} malformed line(s) (first: ` +
          `line ${parsed.malformed[0]}); a torn ledger is never recorded. Run \`warpline fabric repair\` first.`,
        'malformed',
      );
    }
    const dropped = appendOnlyViolations(section.bytes, newBytes);
    if (dropped.length > 0) {
      throw truncationRefusal(section.root, section.ownRef, `this write drops ${dropped.length} recorded strand(s) (first: ${dropped[0]})`);
    }
    if (section.needsAdopt !== null && parsed.lines.length > 0 && opts.adoptCommit === undefined && opts.extraParents === undefined) {
      throw new MirrorRefusal(
        `warpline: fabric write refused — the ledger is empty but this repository already has fabric history ` +
          `(${section.needsAdopt}); sealing now would mint a second genesis (B1). Nothing was written. ` +
          `Run \`warpline mirror adopt\` (it fetches ${section.cfg.remote} ${section.cfg.branch} first), or ` +
          `\`git fetch ${section.cfg.remote} +refs/heads/${section.cfg.branch}:refs/remotes/${section.cfg.remote}/${section.cfg.branch}\`.`,
        'genesis-refused',
      );
    }

    if (parsed.lines.length > 0 && section.cfg.genesis && parsed.lines[0].pickId !== section.cfg.genesis) {
      throw new MirrorRefusal(
        `warpline: fabric write refused — a new genesis ${parsed.lines[0].pickId} would replace the pinned genesis ` +
          `${section.cfg.genesis}. Nothing was written.`,
        'pin-mismatch',
      );
    }
    let commit: string;
    let segOids: string[];
    if (opts.adoptCommit !== undefined) {
      commit = opts.adoptCommit;
      segOids = readCommitShapes(ctx.root, ctx.objectFormat, [commit]).get(commit)?.segments ?? [];
    } else {
      const legacyPath = path.join(section.wdir, 'fabric-legacy.json');
      const legacy = opts.legacy !== undefined ? opts.legacy : fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath) : null;
      const regPath = path.join(section.wdir, 'keys', 'registry.jsonl');
      // the key registry is the signing trust anchor: a fork with no local
      // .warpline/keys CARRIES the registry its record (or the canonical record
      // it extends) already holds — a publish never drops it (review a)
      const registry = registryToRecord(section, opts, regPath);
      const built = buildMirrorTree(ctx.objectFormat, {
        writer: section.wid,
        legacy,
        registry,
        segments: segmentLines(parsed.lines.map((l) => l.raw)),
      });
      const objectsDir = path.join(ctx.commonDir, 'objects');
      for (const o of built.objects) {
        if (o.segment !== undefined && section.segOids[o.segment] === o.oid) continue; // unchanged segment
        writeLooseObject(objectsDir, ctx.objectFormat, o.type, o.body);
      }
      const tip = parsed.lines[parsed.lines.length - 1];
      const message =
        opts.message ?? `warpline: record ${parsed.lines.length} strand(s), tip ${tip?.pickId ?? '(empty)'}`;
      const parents = [
        ...(section.ownCommit ? [section.ownCommit] : section.parentHint ? [section.parentHint] : []),
        ...(opts.extraParents ?? []),
      ].filter(
        (p, i, a) => a.indexOf(p) === i,
      );
      const body = encodeCommit(built.tree, parents, message);
      commit = writeLooseObject(objectsDir, ctx.objectFormat, 'commit', body).oid;
      segOids = built.segmentOids;
    }

    const zero = zeroOid(ctx.objectFormat);
    const updates = [`update ${section.ownRef} ${commit} ${section.ownCommit ?? zero}`];
    const moveBranch =
      !section.branchCheckedOut &&
      ((section.canonical && section.branchTip !== null) || (section.createBranch && section.branchTip === null));
    if (moveBranch) updates.push(`update ${section.branchRef} ${commit} ${section.branchTip ?? zero}`);
    const r = gitRun(ctx.root, ['update-ref', '--create-reflog', '-m', 'warpline: record fabric', '--stdin'], {
      input: updates.join('\n') + '\n',
    });
    if (r.status !== 0) {
      throw new MirrorRefusal(
        `warpline: fabric write refused — the record moved under this write (CAS on ${section.ownRef}` +
          `${moveBranch ? ` / ${section.branchRef}` : ''} failed: ${r.stderr.trim()}). Nothing was written; retry.`,
        'cas',
      );
    }
    section.ownCommit = commit;
    if (moveBranch) {
      section.branchTip = commit;
      section.canonical = true;
      section.createBranch = false;
    }
    section.bytes = Buffer.from(newBytes);
    section.segOids = segOids;
    section.needsAdopt = null;
    section.published++;
    section.parentHint = null;
    const prevCache = readCache(ctx);
    writeCache(ctx, {
      commit,
      size: newBytes.length,
      sha256: sha256(newBytes),
      segments: segOids,
      writers: section.canonical && section.branchTip ? { [section.branchTip]: section.wid } : undefined,
      wasCanonical: moveBranch || prevCache?.wasCanonical === true,
    });
    // (item 6) the branch this writer just advanced is audited by construction
    if (moveBranch) advanceAuditCursor(ctx, section.branchRef, commit);
    return commit;
  });
}

/* ───────────────────────────── the active-section registry ───────────────────────────── */

const active = new Map<string, FabricSection | 'legacy' | 'none'>();
const keyOf = (wdir: string): string => path.resolve(wdir);

export function registerSection(wdir: string, s: FabricSection | 'legacy' | 'none'): void {
  active.set(keyOf(wdir), s);
}
export function unregisterSection(wdir: string): void {
  const s = active.get(keyOf(wdir));
  if (s && typeof s === 'object') s.closed = true;
  active.delete(keyOf(wdir));
}
export function activeSection(wdir: string): FabricSection | 'legacy' | 'none' | undefined {
  return active.get(keyOf(wdir));
}

/**
 * The ledger write chokepoint (fabric.ts appendStrand / rewriteFabric). Inside a
 * mirrored section: publish first, then `write()` the file. Outside any section
 * in a mirrored repo: REFUSE (a write that bypassed #fabric-lock is loud).
 */
export function routeLedgerWrite(wdir: string, newBytes: () => Buffer, write: () => void): void {
  const s = activeSection(wdir);
  if (s === undefined) {
    const root = path.dirname(path.resolve(wdir));
    if (fs.existsSync(path.join(root, '.git'))) {
      const mode = probeMode(root);
      if (mode === 'mirror' || mode === 'pre-migration') {
        throw new MirrorRefusal(
          `warpline: fabric write refused — ${root} records its fabric in git and this write is outside #fabric-lock ` +
            `(no open section), so it could not be recorded first. Route it through withFabricLock.`,
          'outside-section',
        );
      }
    }
    write();
    return;
  }
  if (s === 'legacy' || s === 'none') {
    write();
    return;
  }
  const onDisk = readLedgerBytes(s.root);
  if (!onDisk.equals(s.bytes)) {
    throw truncationRefusal(s.root, s.ownRef, 'the ledger file changed inside the section without being recorded');
  }
  publish(s, newBytes());
  write();
}

/** The layout of `root` without opening a section (read-only; for status, verify, health). */
export function probeMode(root: string): 'none' | 'legacy' | 'pre-migration' | 'mirror' | 'unrecorded' {
  const ctx = gitContext(root);
  if (ctx === null) return 'none';
  return guardGit(ctx, () => {
    const cfg = mirrorConfig(root);
    const refs = readMirrorRefs(ctx, readWriterId(ctx.gitDir), cfg);
    // mirror layout but no record anywhere yet: nothing to protect, the first
    // recorded section seeds it
    if (!ledgerTracked(ctx)) {
      if (refs.own || refs.branch || refs.remote || cfg.genesis || cfg.corrupt) return 'mirror';
      return historySignal(ctx, cfg, refs) !== null ? 'mirror' : 'unrecorded';
    }
    return refs.own || refs.branch || refs.remote || cfg.genesis ? 'pre-migration' : 'legacy';
  });
}

/** Hash helper re-export for tests of the tree format. */
export { hashObject, SEGMENT_STRANDS };

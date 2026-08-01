/**
 * #warp-store — THE WORKTREE INDEX (I5, NATIVE-FIRST phase 0;
 * arky-architecture.md §2 I5: "the one good idea from git's index file").
 * A stat cache for the WORKTREE snapshot path: maps
 * path → {mtimeMs, size, ino, mode, blobId, gitSha} per worktree, anchored at
 * the moment the last snapshot walked it. The next walk compares lstat results
 * against the cache and REHASHES ONLY CHANGED FILES — this is the perf keystone
 * that keeps a warm native propose on a monorepo in seconds, not O(repo) reads.
 *
 * TRUST RULES (each leg fails OPEN to a rehash — the full walk is always the
 * source of truth, mirroring snapshotRef's incremental discipline):
 *   - stat match is mtimeMs + size + ino + derived tree mode (chmod flips mode
 *     without touching mtime — mode is part of the key, so a bare chmod is a miss);
 *   - RACY GUARD (git's racy-timestamp lesson): an entry whose recorded mtime
 *     falls within RACY_WINDOW_MS of the shard's own builtAt is never trusted —
 *     a same-granularity edit right around the index write cannot hide. The
 *     entry re-records on the next walk and becomes trustworthy once its mtime
 *     is comfortably older than the new builtAt;
 *   - the cached blobId must still be present in the object store (a copied or
 *     doctored index can never invent bytes).
 * KNOWN BOUND (inherited from git, accepted): a mutation that preserves mtime,
 * size, ino AND mode — i.e. deliberate stat forgery inside the racy window's
 * shadow — reuses the cached blobId. The racy guard bounds the accidental case;
 * the deliberate case requires the same local write access that could edit the
 * object store itself.
 *
 * ═══ D-G: ONE SHARD PER WORKTREE, NOT ONE SHARED FILE ═══
 *
 * THE DEFECT (soundness audit 2026-07-31, Arky D-G). `worktreeIndex:v1` was a
 * SINGLE `.warpline/index` holding every worktree's section, and `save` was an
 * UNLOCKED read-modify-write of the whole file: read all sections, splice in
 * one, rewrite everything. It is called from `snapshotDir` OUTSIDE the fabric
 * lock, so two concurrent snapshots interleave and the last writer silently
 * drops the other agent's section. And nothing ever pruned a dead worktree's
 * section: one of Arky's stress runs left **54 MB / 308,497 entries across 82
 * sections**, every byte of which every subsequent propose re-read and
 * re-serialized — which also widened the last-writer-wins window from
 * microseconds to hundreds of milliseconds. Self-inflicted, and a swarm
 * scaling wall: cost per save was O(all worktrees ever seen), not O(mine).
 *
 * *vs git:* the index is PER-WORKTREE and protected by `index.lock`. Warpline
 * was weaker on both halves, and unnecessarily so.
 *
 * THE CHOICE — shard, do not lock. `.warpline/index.d/<sha256(worktree)[:40]>`,
 * one file per worktree. Weighed against "lock the shared file + prune it":
 *   1. Sharding removes the SHARING, so there is no critical section to get
 *      wrong. A lock closes the clobber but leaves every save O(all worktrees):
 *      the 54 MB re-serialize survives, and the lock then SERIALIZES every
 *      agent's snapshot behind it — turning a perf keystone into a contention
 *      point on the exact path (a swarm proposing concurrently) it exists for.
 *   2. A lock here is a NEW failure mode on a cache. Every lock has a timeout
 *      and a staleness policy (see the 30-second-wall-clock finding, Arky D-C),
 *      and any of those answers can fail a snapshot for a stat cache whose
 *      whole contract is "any anomaly ⇒ walk cold". A cache that can fail
 *      CLOSED is worse than one that can be stale.
 *   3. Pruning becomes `unlink`, and it is decidable per file: the shard records
 *      the absolute worktree path it caches, so a shard whose worktree no longer
 *      exists is provably dead. In the shared file the same reclaim requires the
 *      same read-modify-write it is trying to make cheap.
 *   4. Blast radius shrinks: a corrupt shard costs ONE worktree a cold walk,
 *      not all 82.
 * Cost of the choice, stated: many small files instead of one big one, and a
 * `readdir` + `stat`-per-shard on each save for pruning (~82 stats ≈ sub-ms,
 * against a walk that reads files). Accepted.
 *
 * CONCURRENCY, precisely. Two writers of the SAME worktree still race — and
 * that race is now benign and total: each writes a COMPLETE shard, atomically,
 * so the loser's shard is replaced whole by the winner's, never merged into a
 * torn state, and neither can touch a THIRD worktree's shard. That is the whole
 * of the D-G guarantee: **a writer's blast radius is exactly its own worktree.**
 *
 * MIGRATION (no orphaning, no cold-walk storm). An existing shared v1 file is
 * adopted rather than abandoned:
 *   - `loadWorktreeIndex` falls back to the v1 file's section when this
 *     worktree has no shard yet, so the very first walk after the upgrade is
 *     still WARM;
 *   - the first `saveWorktreeIndex` SPLITS every v1 section it does not already
 *     have a shard for into shards, then deletes the v1 file — so the other 81
 *     worktrees stay warm too, and the 54 MB is reclaimed once rather than
 *     lingering as a read-only tail.
 * Interleaved migrations are safe by the same fail-open rule: the worst case is
 * a shard written from the stale v1 section over a fresher one, whose entries
 * then fail the stat check and are rehashed.
 *
 * FILE SHAPE (`worktreeIndex:v2`, JSON, atomic tmp+rename): ONE worktree per
 * file — `{schemaVersion, worktree, builtAt, entries}`, entries as compact
 * tuples [mtimeMs, size, ino, mode, blobId, gitSha]. The `worktree` field is
 * verified on read, so a name collision or a copied shard reads as an anomaly
 * rather than as another directory's cache. ANY read anomaly (missing, corrupt,
 * wrong version, wrong worktree) ⇒ null ⇒ the caller walks cold; ANY write
 * failure is swallowed (the index is a cache, never truth).
 *
 * NOT fsync'd, deliberately — see durable.ts, which names this module as the
 * one write path outside the durability discipline: a lost shard costs a cold
 * walk, and hardening a rebuildable cache is a bad trade. The UNIQUE staging
 * name (C-15) is still taken from durable.ts so no fixed `${p}.tmp` can return.
 *
 * Library code: no console output.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpNameFor, isTmpResidue } from './durable.js';
import type { TreeMode } from './tree.js';

/** The per-worktree SHARD schema (`.warpline/index.d/<hash>`). */
export const WORKTREE_INDEX_SCHEMA = 'worktreeIndex:v2' as const;

/** The superseded SHARED-file schema (`.warpline/index`) — read-only, migrated. */
export const LEGACY_WORKTREE_INDEX_SCHEMA = 'worktreeIndex:v1' as const;

/** Entries recorded with mtime within this window of builtAt are never trusted. */
export const RACY_WINDOW_MS = 2000;

/** [mtimeMs, size, ino, mode, blobId, gitSha] — compact on purpose (many rows). */
export type WorktreeIndexEntry = [number, number, number, TreeMode, string, string];

/** One worktree's shard file. */
interface WorktreeShardFile {
  schemaVersion: typeof WORKTREE_INDEX_SCHEMA;
  /** the absolute worktree this shard caches — verified on read. */
  worktree: string;
  builtAt: string; // ISO — the racy-guard anchor
  entries: Record<string, WorktreeIndexEntry>;
}

/** The superseded shared file: sections keyed by absolute worktree path. */
interface LegacyWorktreeIndexFile {
  schemaVersion: typeof LEGACY_WORKTREE_INDEX_SCHEMA;
  worktrees: Record<string, { builtAt: string; entries: Record<string, WorktreeIndexEntry> }>;
}

export interface LoadedWorktreeIndex {
  entries: Map<string, WorktreeIndexEntry>;
  builtAtMs: number;
}

/** The superseded SHARED index file for a repo root (`.warpline/index`). */
export function worktreeIndexPathOf(root: string): string {
  return path.join(root, '.warpline', 'index');
}

/** The shard DIRECTORY for a repo root (`.warpline/index.d`). */
export function worktreeIndexDirOf(root: string): string {
  return path.join(root, '.warpline', 'index.d');
}

const sectionKey = (worktree: string): string => path.resolve(worktree);

/**
 * The shard file for `worktree` under `root`. Named by a hash of the ABSOLUTE
 * worktree path so any path (spaces, unicode, depth) maps to a safe flat name;
 * 160 bits, and the shard carries the path it hashed so a collision fails open.
 */
export function worktreeShardPathOf(root: string, worktree: string): string {
  const key = sectionKey(worktree);
  const hash = crypto.createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 40);
  return path.join(worktreeIndexDirOf(root), hash);
}

/** Parse + validate an entries map; null on ANY malformed row (distrust the shard). */
function parseEntries(raw: unknown): Map<string, WorktreeIndexEntry> | null {
  if (!raw || typeof raw !== 'object') return null;
  const entries = new Map<string, WorktreeIndexEntry>();
  for (const [rel, e] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(e) || e.length !== 6) return null; // malformed row ⇒ distrust the whole shard
    entries.set(rel, e as WorktreeIndexEntry);
  }
  return entries;
}

/** Read the superseded shared file, or null when it is absent/corrupt/wrong-version. */
function readLegacyIndex(root: string): LegacyWorktreeIndexFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(worktreeIndexPathOf(root), 'utf8')) as LegacyWorktreeIndexFile;
    if (parsed?.schemaVersion !== LEGACY_WORKTREE_INDEX_SCHEMA) return null;
    if (!parsed.worktrees || typeof parsed.worktrees !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadedFrom(builtAt: unknown, rawEntries: unknown): LoadedWorktreeIndex | null {
  if (typeof builtAt !== 'string') return null;
  const builtAtMs = Date.parse(builtAt);
  if (!Number.isFinite(builtAtMs)) return null;
  const entries = parseEntries(rawEntries);
  if (!entries) return null;
  return { entries, builtAtMs };
}

/**
 * Load the cached shard for `worktree`. ANY anomaly (missing file, corrupt
 * JSON, wrong schema, wrong worktree, malformed row) returns null — fail OPEN
 * to a cold walk. When no shard exists yet, the superseded shared v1 file is
 * consulted read-only so the first walk after the D-G upgrade is still warm.
 */
export function loadWorktreeIndex(root: string, worktree: string): LoadedWorktreeIndex | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(worktreeShardPathOf(root, worktree), 'utf8'),
    ) as WorktreeShardFile;
    if (parsed?.schemaVersion !== WORKTREE_INDEX_SCHEMA) return null;
    if (parsed.worktree !== sectionKey(worktree)) return null; // collision / copied shard
    return loadedFrom(parsed.builtAt, parsed.entries);
  } catch {
    /* no shard (or an unreadable one) — try the superseded shared file */
  }
  const legacy = readLegacyIndex(root);
  const section = legacy?.worktrees?.[sectionKey(worktree)];
  if (!section) return null;
  return loadedFrom(section.builtAt, section.entries);
}

/**
 * Write one shard atomically. Throws on failure; callers decide the posture.
 * KEY ORDER IS LOAD-BEARING: `worktree` is serialized before `entries` so
 * `pruneWorktreeIndex` can read it from a bounded header rather than parsing
 * the whole cache (see SHARD_HEADER_BYTES).
 */
function writeShard(target: string, file: WorktreeShardFile): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const body = JSON.stringify({
    schemaVersion: file.schemaVersion,
    worktree: file.worktree, // ← before `entries`, on purpose (prune's header read)
    builtAt: file.builtAt,
    entries: file.entries,
  });
  const tmp = tmpNameFor(target); // C-15: never a shared staging name
  try {
    fs.writeFileSync(tmp, body, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(tmp, target); // atomic publish — a torn shard reads as corrupt ⇒ cold walk
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* residue cleanup is best-effort */
    }
    throw err;
  }
}

/**
 * Split the superseded shared v1 file into shards and delete it. Only sections
 * that have NO shard yet are written, so a concurrent writer's fresher shard is
 * never overwritten by the stale v1 copy of the same worktree. Best-effort at
 * every step — migration is a convenience, and its failure only costs a cold walk.
 */
function migrateLegacyIndex(root: string): void {
  const legacy = readLegacyIndex(root);
  if (!legacy) {
    // Nothing usable (absent, corrupt, already migrated). Remove a corrupt or
    // wrong-version leftover so it is not re-read on every save forever.
    try {
      if (fs.existsSync(worktreeIndexPathOf(root))) fs.rmSync(worktreeIndexPathOf(root), { force: true });
    } catch {
      /* best-effort */
    }
    return;
  }
  for (const [key, section] of Object.entries(legacy.worktrees)) {
    const target = worktreeShardPathOf(root, key);
    if (fs.existsSync(target)) continue; // a live shard always wins over the v1 copy
    if (!section || typeof section.builtAt !== 'string' || !section.entries) continue;
    try {
      writeShard(target, {
        schemaVersion: WORKTREE_INDEX_SCHEMA,
        worktree: sectionKey(key),
        builtAt: section.builtAt,
        entries: section.entries,
      });
    } catch {
      /* one un-migratable section costs that worktree a cold walk */
    }
  }
  try {
    fs.rmSync(worktreeIndexPathOf(root), { force: true });
  } catch {
    /* best-effort */
  }
}

/**
 * How much of a shard prune reads to find its `worktree`. The field is the
 * SECOND key written (see writeShard) precisely so this stays a bounded header
 * read: prune must not become the O(all worktrees) re-read it exists to remove.
 * A path that does not fit here simply never prunes — the safe direction.
 */
const SHARD_HEADER_BYTES = 4096;

const WORKTREE_FIELD = /"worktree":("(?:[^"\\]|\\.)*")/;

/** The worktree a shard caches, from a BOUNDED header read (never a full parse). */
function shardWorktreeOf(p: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(p, 'r');
  } catch {
    return null;
  }
  try {
    const buf = Buffer.allocUnsafe(SHARD_HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, SHARD_HEADER_BYTES, 0);
    const m = WORKTREE_FIELD.exec(buf.subarray(0, n).toString('utf8'));
    if (!m) return null;
    const value: unknown = JSON.parse(m[1]);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Delete shards whose recorded worktree no longer exists — the D-G reclaim half.
 * Returns the number removed. Cost is one bounded header read per shard, NOT a
 * parse of the cache itself, so reclaiming stays off the scaling path.
 *
 * A shard for a temporarily-unavailable worktree is reclaimed too and simply
 * re-warms on the next walk (fail-open, by design). Two things are never
 * touched: staging residue (a `.tmp.*` name may belong to a writer that is
 * mid-publish RIGHT NOW — deleting it would fail that writer's rename, which is
 * the cross-writer clobber D-G exists to remove), and any shard whose header
 * does not yield a worktree (unreadable, truncated, or an unrecognized shape:
 * it already fails open on read, and guessing is how a cache starts deleting).
 */
export function pruneWorktreeIndex(root: string, keep?: string): number {
  const dir = worktreeIndexDirOf(root);
  const keepPath = keep ? worktreeShardPathOf(root, keep) : null;
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0; // no shard directory yet
  }
  for (const name of names) {
    if (isTmpResidue(name)) continue;
    const p = path.join(dir, name);
    if (p === keepPath) continue;
    const worktree = shardWorktreeOf(p);
    if (worktree === null) continue;
    try {
      if (fs.existsSync(worktree)) continue; // still live
      fs.rmSync(p, { force: true });
      removed++;
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

/**
 * Publish the entries the walk just produced as THIS worktree's shard. No other
 * worktree's shard is read, rewritten or even opened — that is the D-G fix, and
 * it is why no lock is needed. Atomic tmp+rename; every failure is swallowed —
 * a cache write must never fail a snapshot.
 */
export function saveWorktreeIndex(
  root: string,
  worktree: string,
  entries: Map<string, WorktreeIndexEntry>,
): void {
  try {
    // One-time D-G migration: adopt (rather than orphan) a shared v1 file, so
    // the other worktrees it holds do not all fall to a cold walk at once.
    if (fs.existsSync(worktreeIndexPathOf(root))) migrateLegacyIndex(root);

    writeShard(worktreeShardPathOf(root, worktree), {
      schemaVersion: WORKTREE_INDEX_SCHEMA,
      worktree: sectionKey(worktree),
      builtAt: new Date().toISOString(),
      entries: Object.fromEntries(entries),
    });
  } catch {
    /* cache only — never fail the snapshot */
  }
  try {
    // Reclaim dead worktrees' shards. O(shards) stats, off the hashing path.
    pruneWorktreeIndex(root, worktree);
  } catch {
    /* best-effort */
  }
}

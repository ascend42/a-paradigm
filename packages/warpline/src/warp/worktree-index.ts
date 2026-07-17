/**
 * #warp-store — THE WORKTREE INDEX (I5, NATIVE-FIRST phase 0;
 * arky-architecture.md §2 I5: "the one good idea from git's index file").
 * A stat cache for the WORKTREE snapshot path: `.warpline/index` maps
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
 *     falls within RACY_WINDOW_MS of the index's own builtAt is never trusted —
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
 * FILE SHAPE (`worktreeIndex:v1`, JSON, atomic tmp+rename): sections keyed by
 * absolute worktree path (one store root can index several agent worktrees);
 * entries are compact tuples [mtimeMs, size, ino, mode, blobId, gitSha]. ANY
 * read anomaly (missing, corrupt, wrong version) ⇒ null ⇒ the caller walks
 * cold; ANY write failure is swallowed (the index is a cache, never truth).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TreeMode } from './tree.js';

export const WORKTREE_INDEX_SCHEMA = 'worktreeIndex:v1' as const;

/** Entries recorded with mtime within this window of builtAt are never trusted. */
export const RACY_WINDOW_MS = 2000;

/** [mtimeMs, size, ino, mode, blobId, gitSha] — compact on purpose (many rows). */
export type WorktreeIndexEntry = [number, number, number, TreeMode, string, string];

interface WorktreeSection {
  builtAt: string; // ISO — the racy-guard anchor
  entries: Record<string, WorktreeIndexEntry>;
}

interface WorktreeIndexFile {
  schemaVersion: typeof WORKTREE_INDEX_SCHEMA;
  worktrees: Record<string, WorktreeSection>;
}

export interface LoadedWorktreeIndex {
  entries: Map<string, WorktreeIndexEntry>;
  builtAtMs: number;
}

/** `.warpline/index` for a repo root. */
export function worktreeIndexPathOf(root: string): string {
  return path.join(root, '.warpline', 'index');
}

const sectionKey = (worktree: string): string => path.resolve(worktree);

/**
 * Load the cached section for `worktree`. ANY anomaly (missing file, corrupt
 * JSON, wrong schema, malformed section) returns null — fail OPEN to a cold walk.
 */
export function loadWorktreeIndex(root: string, worktree: string): LoadedWorktreeIndex | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(worktreeIndexPathOf(root), 'utf8')) as WorktreeIndexFile;
    if (parsed?.schemaVersion !== WORKTREE_INDEX_SCHEMA) return null;
    const section = parsed.worktrees?.[sectionKey(worktree)];
    if (!section || typeof section.builtAt !== 'string' || typeof section.entries !== 'object' || section.entries === null) {
      return null;
    }
    const builtAtMs = Date.parse(section.builtAt);
    if (!Number.isFinite(builtAtMs)) return null;
    const entries = new Map<string, WorktreeIndexEntry>();
    for (const [rel, e] of Object.entries(section.entries)) {
      if (!Array.isArray(e) || e.length !== 6) return null; // malformed row ⇒ distrust the whole section
      entries.set(rel, e as WorktreeIndexEntry);
    }
    return { entries, builtAtMs };
  } catch {
    return null;
  }
}

/**
 * Replace the section for `worktree` with the entries the walk just produced
 * (other worktrees' sections are preserved). Atomic tmp+rename; every failure
 * is swallowed — a cache write must never fail a snapshot.
 */
export function saveWorktreeIndex(
  root: string,
  worktree: string,
  entries: Map<string, WorktreeIndexEntry>,
): void {
  try {
    const p = worktreeIndexPathOf(root);
    let file: WorktreeIndexFile = { schemaVersion: WORKTREE_INDEX_SCHEMA, worktrees: {} };
    try {
      const existing = JSON.parse(fs.readFileSync(p, 'utf8')) as WorktreeIndexFile;
      if (existing?.schemaVersion === WORKTREE_INDEX_SCHEMA && existing.worktrees) file = existing;
    } catch {
      /* fresh file */
    }
    file.worktrees[sectionKey(worktree)] = {
      builtAt: new Date().toISOString(),
      entries: Object.fromEntries(entries),
    };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(file), 'utf8');
    fs.renameSync(tmp, p); // atomic publish — a torn index reads as corrupt ⇒ cold walk
  } catch {
    /* cache only — never fail the snapshot */
  }
}

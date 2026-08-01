/**
 * worktree-index-sharding.test — soundness audit D-G (Arky): the shared
 * `.warpline/index` was an UNLOCKED read-modify-write of every worktree's
 * section that never pruned a dead one (54 MB / 308,497 entries / 82 sections
 * after one stress run).
 *
 * Two halves, and this file closes both:
 *   1. CONCURRENT WRITERS MUST NOT DROP EACH OTHER'S SECTIONS — proven
 *      structurally rather than by wall-clock luck: a save touches exactly one
 *      file and never another worktree's, and the precise interleaving that
 *      dropped a section (read A · save B · save A) now keeps both. The
 *      two-real-processes demonstration lives in
 *      bench/worktree-index-dg.mjs, next to the before/after measurement.
 *   2. DEAD SECTIONS MUST BE RECLAIMABLE — a shard whose worktree is gone is
 *      deleted; a live one is not.
 * Plus the migration contract: an existing shared v1 file is adopted, not
 * orphaned, and does not cause a cold-walk storm on the first run after the change.
 *
 * The cache posture is preserved throughout: every anomaly still fails OPEN to a
 * cold walk. A cache that can fail CLOSED is worse than one that can be stale.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadWorktreeIndex,
  saveWorktreeIndex,
  pruneWorktreeIndex,
  worktreeIndexPathOf,
  worktreeIndexDirOf,
  worktreeShardPathOf,
  WORKTREE_INDEX_SCHEMA,
  LEGACY_WORKTREE_INDEX_SCHEMA,
  type WorktreeIndexEntry,
} from '../src/warp/worktree-index.js';

const entry = (n: number): WorktreeIndexEntry => [1_700_000_000_000 + n, n, 1000 + n, '100644', `blob:v1:${'0'.repeat(58)}${(n % 100).toString().padStart(2, '0')}`, 'a'.repeat(40)];

function entries(prefix: string, count: number): Map<string, WorktreeIndexEntry> {
  const m = new Map<string, WorktreeIndexEntry>();
  for (let i = 0; i < count; i++) m.set(`${prefix}/f${i}.ts`, entry(i));
  return m;
}

/** Every non-staging shard file currently on disk. */
function shards(root: string): string[] {
  try {
    return fs.readdirSync(worktreeIndexDirOf(root)).filter((n) => !/\.tmp(\.|$)/.test(n)).sort();
  } catch {
    return [];
  }
}

describe('D-G — one shard per worktree: concurrent writers cannot drop each other', () => {
  let root: string;
  let wtA: string;
  let wtB: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-root-'));
    wtA = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-wtA-'));
    wtB = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-wtB-'));
  });
  afterEach(() => {
    for (const d of [root, wtA, wtB]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('a save writes ONE file and leaves every other worktree byte-for-byte untouched', () => {
    saveWorktreeIndex(root, wtB, entries('b', 40));
    const shardB = worktreeShardPathOf(root, wtB);
    const before = fs.statSync(shardB);
    const bytesBefore = fs.readFileSync(shardB);

    saveWorktreeIndex(root, wtA, entries('a', 7));

    // The whole D-G guarantee: A's blast radius is exactly A's own worktree.
    const after = fs.statSync(shardB);
    expect(after.ino).toBe(before.ino); // not republished by A's rename
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(fs.readFileSync(shardB).equals(bytesBefore)).toBe(true);
    expect(shards(root).length).toBe(2); // two worktrees, two files, no sharing

    expect(loadWorktreeIndex(root, wtB)!.entries.size).toBe(40);
    expect(loadWorktreeIndex(root, wtA)!.entries.size).toBe(7);
  });

  it('the interleaving that dropped a section — read A, save B, save A — keeps both', () => {
    // The exact shape of the D-G race, driven deterministically: under the
    // shared read-modify-write, A's rewrite of the whole file (built from a
    // snapshot taken before B wrote) erased B. Sharding removes the shared
    // object the interleaving needed.
    saveWorktreeIndex(root, wtA, entries('a', 5));
    const aSeen = loadWorktreeIndex(root, wtA)!; // A reads
    saveWorktreeIndex(root, wtB, entries('b', 5)); // B writes in between
    saveWorktreeIndex(root, wtA, aSeen.entries); // A writes what it had read

    expect(loadWorktreeIndex(root, wtB)?.entries.size).toBe(5); // B survived A
    expect(loadWorktreeIndex(root, wtA)?.entries.size).toBe(5);
  });

  it('a shard is bound to its worktree: a copied shard reads as an anomaly, not as another dir cache', () => {
    saveWorktreeIndex(root, wtA, entries('a', 3));
    fs.copyFileSync(worktreeShardPathOf(root, wtA), worktreeShardPathOf(root, wtB));
    expect(loadWorktreeIndex(root, wtB)).toBeNull(); // fails OPEN — cold walk, never A's bytes
    expect(loadWorktreeIndex(root, wtA)?.entries.size).toBe(3);
  });
});

describe('D-G — dead sections are reclaimable', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-prune-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('prune deletes shards whose worktree is gone and keeps the ones that are not', () => {
    const live = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-live-'));
    const dead: string[] = [];
    try {
      saveWorktreeIndex(root, live, entries('live', 3));
      for (let i = 0; i < 4; i++) {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), `warpline-dg-dead${i}-`));
        dead.push(d);
        saveWorktreeIndex(root, d, entries(`d${i}`, 3));
      }
      expect(shards(root).length).toBe(5);

      for (const d of dead) fs.rmSync(d, { recursive: true, force: true });
      expect(pruneWorktreeIndex(root)).toBe(4);
      expect(shards(root)).toEqual([path.basename(worktreeShardPathOf(root, live))]);
      expect(loadWorktreeIndex(root, live)?.entries.size).toBe(3); // the live cache is intact
    } finally {
      fs.rmSync(live, { recursive: true, force: true });
    }
  });

  it('a save reclaims dead shards as it goes, so the store cannot grow to 82 forever', () => {
    const live = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-live2-'));
    try {
      for (let i = 0; i < 6; i++) {
        const d = fs.mkdtempSync(path.join(os.tmpdir(), `warpline-dg-gone${i}-`));
        saveWorktreeIndex(root, d, entries(`g${i}`, 2));
        fs.rmSync(d, { recursive: true, force: true });
      }
      saveWorktreeIndex(root, live, entries('live', 2));
      expect(shards(root).length).toBe(1); // only the live worktree remains
      expect(loadWorktreeIndex(root, live)?.entries.size).toBe(2);
    } finally {
      fs.rmSync(live, { recursive: true, force: true });
    }
  });

  it('prune reads a BOUNDED header, not the cache — reclaiming stays off the scaling path', () => {
    // The reclaim half must not reintroduce the O(all worktrees) re-read it
    // exists to remove. Proof by construction: a shard whose HEADER is intact
    // but whose entries are truncated garbage is still prunable — which is only
    // possible if prune never parsed the entries.
    const gone = path.join(os.tmpdir(), 'warpline-dg-never-existed-xyz');
    const dir = worktreeIndexDirOf(root);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'a'.repeat(40));
    fs.writeFileSync(
      p,
      `{"schemaVersion":"${WORKTREE_INDEX_SCHEMA}","worktree":${JSON.stringify(gone)},"builtAt":"${new Date().toISOString()}","entries":{"x":[1,2,3,`,
      'utf8',
    );
    expect(loadWorktreeIndex(root, gone)).toBeNull(); // still fails OPEN on read
    expect(pruneWorktreeIndex(root)).toBe(1);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('prune leaves staging residue and unreadable shards alone (a `.tmp.*` may be mid-publish)', () => {
    const live = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-live3-'));
    try {
      saveWorktreeIndex(root, live, entries('live', 2));
      const dir = worktreeIndexDirOf(root);
      // A staging file holds a COMPLETE shard in the instant before its rename.
      // Deleting one because prune judged its worktree dead would fail another
      // writer's publish with ENOENT — a cross-writer clobber, which is the
      // whole class D-G exists to remove. It is skipped on the NAME.
      const staging = path.join(dir, 'deadbeef.tmp.999.0');
      fs.writeFileSync(
        staging,
        JSON.stringify({
          schemaVersion: WORKTREE_INDEX_SCHEMA,
          worktree: path.join(os.tmpdir(), 'warpline-dg-not-there'),
          builtAt: new Date().toISOString(),
          entries: {},
        }),
        'utf8',
      );
      const unreadable = path.join(dir, 'cafebabe');
      fs.writeFileSync(unreadable, 'not json{{{', 'utf8'); // already fails open on read

      expect(pruneWorktreeIndex(root)).toBe(0);
      expect(fs.existsSync(staging)).toBe(true);
      expect(fs.existsSync(unreadable)).toBe(true);
      expect(loadWorktreeIndex(root, live)?.entries.size).toBe(2);
    } finally {
      fs.rmSync(live, { recursive: true, force: true });
    }
  });
});

describe('D-G — migration off the shared v1 file', () => {
  let root: string;
  let wtA: string;
  let wtB: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-mig-'));
    wtA = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-migA-'));
    wtB = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dg-migB-'));
  });
  afterEach(() => {
    for (const d of [root, wtA, wtB]) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Write a pre-D-G `worktreeIndex:v1` shared file holding both worktrees. */
  function seedLegacy(): void {
    const builtAt = new Date(Date.now() - 60_000).toISOString();
    fs.mkdirSync(path.dirname(worktreeIndexPathOf(root)), { recursive: true });
    fs.writeFileSync(
      worktreeIndexPathOf(root),
      JSON.stringify({
        schemaVersion: LEGACY_WORKTREE_INDEX_SCHEMA,
        worktrees: {
          [path.resolve(wtA)]: { builtAt, entries: Object.fromEntries(entries('a', 11)) },
          [path.resolve(wtB)]: { builtAt, entries: Object.fromEntries(entries('b', 22)) },
        },
      }),
      'utf8',
    );
  }

  it('a legacy section is still WARM before any save — no cold walk on first run', () => {
    seedLegacy();
    expect(loadWorktreeIndex(root, wtA)?.entries.size).toBe(11);
    expect(loadWorktreeIndex(root, wtB)?.entries.size).toBe(22);
  });

  it('the first save splits EVERY section into shards and reclaims the shared file', () => {
    seedLegacy();
    saveWorktreeIndex(root, wtA, entries('a', 12)); // A saves; B never runs

    expect(fs.existsSync(worktreeIndexPathOf(root))).toBe(false); // the 54 MB is reclaimed
    expect(shards(root).length).toBe(2);
    expect(loadWorktreeIndex(root, wtA)?.entries.size).toBe(12); // A's fresh walk
    expect(loadWorktreeIndex(root, wtB)?.entries.size).toBe(22); // B stayed warm — no storm
    const raw = JSON.parse(fs.readFileSync(worktreeShardPathOf(root, wtB), 'utf8'));
    expect(raw.schemaVersion).toBe(WORKTREE_INDEX_SCHEMA);
    expect(raw.worktree).toBe(path.resolve(wtB));
  });

  it('migration never overwrites a live shard with the stale v1 copy of the same worktree', () => {
    saveWorktreeIndex(root, wtB, entries('b', 99)); // B is already sharded and fresher
    seedLegacy(); // a v1 file reappears carrying an older B
    saveWorktreeIndex(root, wtA, entries('a', 1));
    expect(loadWorktreeIndex(root, wtB)?.entries.size).toBe(99); // fresh shard wins over v1
  });

  it('a corrupt legacy file fails OPEN and is reclaimed rather than re-read forever', () => {
    fs.mkdirSync(path.dirname(worktreeIndexPathOf(root)), { recursive: true });
    fs.writeFileSync(worktreeIndexPathOf(root), 'not json at all{{{', 'utf8');
    expect(loadWorktreeIndex(root, wtA)).toBeNull(); // cold walk, not a throw
    saveWorktreeIndex(root, wtA, entries('a', 4));
    expect(fs.existsSync(worktreeIndexPathOf(root))).toBe(false);
    expect(loadWorktreeIndex(root, wtA)?.entries.size).toBe(4);
  });
});

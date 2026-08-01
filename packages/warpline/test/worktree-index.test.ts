/**
 * worktree-index.test — I5, NATIVE-FIRST phase 0 (arky-architecture.md §2 I5):
 * the `.warpline/index.d/<hash>` per-worktree stat cache behind the snapshot walk.
 *
 * THE INVARIANT (same discipline as snapshot-incremental.test): the INDEXED
 * walk must produce the BYTE-IDENTICAL treeId + gitOid the plain full walk
 * produces — cold, warm, and after every mutation kind (touch / edit / add /
 * delete / chmod). Plus: the path-taken proof (a warm walk provably never
 * re-reads unchanged bytes), the racy-timestamp guard, fail-open on a corrupt
 * index, and the cached-blob-missing insurance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir } from '../src/warp/snapshot.js';
import {
  loadWorktreeIndex,
  worktreeShardPathOf,
  WORKTREE_INDEX_SCHEMA,
} from '../src/warp/worktree-index.js';
import { forkNative, proposeNative } from '../src/fabric/native.js';

/** Backdate a path's atime+mtime so cache entries clear the racy guard. */
function backdate(p: string, secondsAgo = 10): void {
  const t = (Date.now() - secondsAgo * 1000) / 1000;
  fs.utimesSync(p, t, t);
}

function write(dir: string, rel: string, body: string, opts: { exec?: boolean; keepFresh?: boolean } = {}): string {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
  if (opts.exec) fs.chmodSync(full, 0o755);
  if (!opts.keepFresh) backdate(full);
  return full;
}

/** The fixture: nested dirs, an executable, a symlink, an exotic filename. */
function seed(wt: string): void {
  write(wt, 'a.txt', 'alpha\n');
  write(wt, 'sub/b.txt', 'beta\n');
  write(wt, 'deep/nested/c.ts', 'export const c = 3;\n');
  write(wt, 'exec.sh', '#!/bin/sh\necho hi\n', { exec: true });
  write(wt, 'space name/odd file.txt', 'odd\n');
  fs.symlinkSync('a.txt', path.join(wt, 'link.txt'));
}
const SEED_FILES = 5; // regular files (symlinks are never cached)

describe('I5 — the worktree stat cache (.warpline/index.d)', () => {
  let root: string; // fabric home: store + index
  let wt: string; // the worktree being snapshotted
  let store: ObjectStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-wtidx-root-'));
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-wtidx-wt-'));
    store = new ObjectStore(root);
    seed(wt);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(wt, { recursive: true, force: true });
  });

  /** A plain full walk in a FRESH store — the source-of-truth comparator. */
  function coldTruth(): { treeId: string; gitOid: string } {
    const freshRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-wtidx-cold-'));
    try {
      const snap = snapshotDir(new ObjectStore(freshRoot), wt);
      return { treeId: snap.treeId, gitOid: snap.gitOid };
    } finally {
      fs.rmSync(freshRoot, { recursive: true, force: true });
    }
  }

  it('cold-indexed, warm-indexed, and plain walks are byte-identical (treeId + gitOid)', () => {
    const truth = coldTruth();
    const cold = snapshotDir(store, wt, { indexRoot: root });
    expect(cold.treeId).toBe(truth.treeId);
    expect(cold.gitOid).toBe(truth.gitOid);
    expect(cold.indexed).toEqual({ hits: 0, misses: SEED_FILES }); // nothing cached yet
    expect(fs.existsSync(worktreeShardPathOf(root, wt))).toBe(true);

    const warm = snapshotDir(store, wt, { indexRoot: root });
    expect(warm.treeId).toBe(truth.treeId); // ← the headline invariant
    expect(warm.gitOid).toBe(truth.gitOid);
    expect(warm.indexed).toEqual({ hits: SEED_FILES, misses: 0 }); // fully warm
  });

  it('mutation detection: touch / edit / add / delete / chmod each land in the tree', () => {
    snapshotDir(store, wt, { indexRoot: root }); // build the index
    const before = snapshotDir(store, wt, { indexRoot: root });
    expect(before.indexed!.hits).toBe(SEED_FILES);

    // touch: mtime bump, same bytes — must rehash (miss), tree unchanged.
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(wt, 'deep/nested/c.ts'), now, now);
    // edit: new bytes.
    write(wt, 'a.txt', 'alpha v2 — edited\n');
    // add: new file (new dir too).
    write(wt, 'brand/new.txt', 'fresh\n');
    // delete: empties sub/ (empty dirs are omitted — git parity).
    fs.rmSync(path.join(wt, 'sub/b.txt'));
    // chmod: mode flip WITHOUT an mtime change — mode is part of the stat key.
    fs.chmodSync(path.join(wt, 'exec.sh'), 0o644);

    const truth = coldTruth();
    const mutated = snapshotDir(store, wt, { indexRoot: root });
    expect(mutated.treeId).toBe(truth.treeId); // every mutation detected
    expect(mutated.gitOid).toBe(truth.gitOid);
    expect(mutated.treeId).not.toBe(before.treeId);
    // The unchanged file (odd file.txt) still hit; the four touched/edited/added/
    // chmod'd paths missed (the delete simply vanishes — no miss to record).
    expect(mutated.indexed!.hits).toBe(1);
    expect(mutated.indexed!.misses).toBe(4);

    // A further walk is warm again — except the touched file, whose fresh mtime
    // sits inside the racy window of the index it was just recorded in (by design).
    const settled = snapshotDir(store, wt, { indexRoot: root });
    expect(settled.treeId).toBe(truth.treeId);
    expect(settled.indexed!.hits).toBe(4);
    expect(settled.indexed!.misses).toBe(1); // deep/nested/c.ts — racy-guarded rehash
  });

  it('path-taken proof: a warm hit provably reuses the cached blob without reading the file', () => {
    snapshotDir(store, wt, { indexRoot: root });
    const warmBefore = snapshotDir(store, wt, { indexRoot: root });
    expect(warmBefore.indexed!.hits).toBe(SEED_FILES);

    // Forge a stat-identical mutation: same length, same inode (in-place write),
    // mtime restored to the recorded value. The stat key cannot distinguish it,
    // so the walk MUST reuse the cached blob — proving unchanged files are never
    // re-read on the warm path. (The documented, git-inherited bound: deliberate
    // stat forgery outside the racy window reuses the cache; see worktree-index.ts.)
    const target = path.join(wt, 'a.txt');
    const st = fs.lstatSync(target);
    fs.writeFileSync(target, 'ALPHA\n'); // same byte length as 'alpha\n'
    fs.utimesSync(target, st.atimeMs / 1000, st.mtimeMs / 1000);

    const forged = snapshotDir(store, wt, { indexRoot: root });
    expect(forged.indexed).toEqual({ hits: SEED_FILES, misses: 0 });
    expect(forged.treeId).toBe(warmBefore.treeId); // stale blob reused ⇒ cache path taken
    expect(forged.treeId).not.toBe(coldTruth().treeId); // a cold walk sees the new bytes
  });

  it('racy guard: an entry recorded within the racy window of builtAt is never trusted', () => {
    write(wt, 'racy.txt', 'racy\n', { keepFresh: true }); // mtime ≈ index builtAt
    snapshotDir(store, wt, { indexRoot: root }); // records racy.txt at ~builtAt
    const warm = snapshotDir(store, wt, { indexRoot: root });
    // The backdated seed files hit; racy.txt is inside the window ⇒ rehashed.
    expect(warm.indexed!.hits).toBe(SEED_FILES);
    expect(warm.indexed!.misses).toBe(1);
  });

  it('fails OPEN on a corrupt or wrong-schema index, then heals it', () => {
    snapshotDir(store, wt, { indexRoot: root });
    const truth = coldTruth();
    const shard = worktreeShardPathOf(root, wt);

    fs.writeFileSync(shard, 'not json at all{{{', 'utf8');
    const afterCorrupt = snapshotDir(store, wt, { indexRoot: root });
    expect(afterCorrupt.treeId).toBe(truth.treeId);
    expect(afterCorrupt.indexed!.hits).toBe(0); // cold — the corrupt cache was distrusted
    expect(loadWorktreeIndex(root, wt)?.entries.size).toBe(SEED_FILES); // healed by the walk

    fs.writeFileSync(
      shard,
      JSON.stringify({ schemaVersion: 'worktreeIndex:v999', worktree: wt, builtAt: new Date().toISOString(), entries: {} }),
      'utf8',
    );
    const afterWrongSchema = snapshotDir(store, wt, { indexRoot: root });
    expect(afterWrongSchema.treeId).toBe(truth.treeId);
    expect(afterWrongSchema.indexed!.hits).toBe(0);

    const healed = snapshotDir(store, wt, { indexRoot: root });
    expect(healed.indexed).toEqual({ hits: SEED_FILES, misses: 0 });
    expect(loadWorktreeIndex(root, wt)).not.toBeNull();
    const raw = JSON.parse(fs.readFileSync(shard, 'utf8'));
    expect(raw.schemaVersion).toBe(WORKTREE_INDEX_SCHEMA);
  });

  it('insurance: a cached blobId missing from the store forces a rehash (cache can never invent bytes)', () => {
    snapshotDir(store, wt, { indexRoot: root });
    // Delete an unchanged file's loose blob out from under the cache.
    const cached = loadWorktreeIndex(root, wt)!;
    const blob = cached.entries.get('sub/b.txt')![4];
    const hex = blob.slice('blob:v1:'.length);
    const loose = path.join(root, '.warpline', 'objects', 'blobs', hex.slice(0, 2), hex.slice(2));
    fs.rmSync(loose);

    const truth = coldTruth();
    const snap = snapshotDir(store, wt, { indexRoot: root });
    expect(snap.treeId).toBe(truth.treeId);
    expect(snap.indexed!.misses).toBe(1); // exactly the evicted blob's file
    expect(fs.existsSync(loose)).toBe(true); // re-ingested — the tree is materializable again
  });

  it('two worktrees each get their own shard without clobbering each other', () => {
    const wt2 = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-wtidx-wt2-'));
    try {
      write(wt2, 'other.txt', 'other\n');
      snapshotDir(store, wt, { indexRoot: root });
      snapshotDir(store, wt2, { indexRoot: root });
      expect(loadWorktreeIndex(root, wt)?.entries.size).toBe(SEED_FILES);
      expect(loadWorktreeIndex(root, wt2)?.entries.size).toBe(1);
      const warm = snapshotDir(store, wt, { indexRoot: root });
      expect(warm.indexed).toEqual({ hits: SEED_FILES, misses: 0 });
    } finally {
      fs.rmSync(wt2, { recursive: true, force: true });
    }
  });
});

describe('I5 end to end — the native propose path rides the index', () => {
  it('proposeNative writes a .warpline/index.d shard and a re-propose walks warm off it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-wtidx-native-'));
    const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-wtidx-native-wt-'));
    try {
      write(wt, 'src/mod.ts', 'export function foo() { return 1; }\n');
      forkNative(root, 'agent-i5');
      const first = await proposeNative(root, {
        worktree: wt, agentId: 'agent-i5', intent: 'genesis (I5 fixture)',
      });
      expect(first.noop).toBe(false);
      const idx = loadWorktreeIndex(root, wt);
      expect(idx).not.toBeNull(); // the propose walk left a warm index behind
      expect(idx!.entries.size).toBe(1);

      write(wt, 'src/mod.ts', 'export function foo() { return 42; }\n');
      const second = await proposeNative(root, {
        worktree: wt, agentId: 'agent-i5', intent: 'edit foo (warm walk)',
      });
      expect(second.noop).toBe(false);
      expect(second.treeId).not.toBe(first.treeId); // the edit was seen through the cache
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(wt, { recursive: true, force: true });
    }
  }, 120_000);
});

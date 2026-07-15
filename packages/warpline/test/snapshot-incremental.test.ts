/**
 * snapshot-incremental.test — T-2026-07-04-003 byte layer (delta-native admit).
 *
 * THE INVARIANT (determinism is the thesis): the INCREMENTAL ref snapshot —
 * base tree + git-diff overlay via writeMergedTree — must produce the
 * BYTE-IDENTICAL treeId the full walk produces, on real fixtures covering:
 * edits, adds, deletes, nested dirs, mode flips, symlinks, exotic filenames,
 * and T-033 tracked-.warpline filtering. Plus: the anchor verification gate
 * (strandSnapshotAnchor), fail-open on bad anchors, catFileBatch fail-closed,
 * and the end-to-end proof that an anchored admit binds the same treeId a
 * cold full snapshot computes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { snapshotRef, strandSnapshotAnchor, restoreTree } from '../src/warp/snapshot.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { blobId } from '../src/warp/blob.js';
import { catFileBatch, diffRaw, revParse, revParseTree } from '../src/git/git-exec.js';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import type { Strand } from '../src/fabric/strand.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'main');
    await r.git('config', 'user.email', 'inc@warpline.test');
    await r.git('config', 'user.name', 'Warpline Inc');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<string> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
    return this.git('rev-parse', 'HEAD');
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

/** A fresh store in its own temp root (so cold/warm comparisons never share objects). */
async function freshStore(): Promise<{ store: ObjectStore; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-inc-store-'));
  return { store: new ObjectStore(root), root };
}

const cleanups: string[] = [];
afterEach(async () => {
  while (cleanups.length) await fs.rm(cleanups.pop()!, { recursive: true, force: true });
});

/** Base commit with nested dirs, an executable, and a symlink. */
async function seedBase(repo: Repo): Promise<string> {
  await repo.write('README.md', 'hello\n');
  await repo.write('src/a.ts', 'export const a = 1;\n');
  await repo.write('src/deep/nested/b.ts', 'export const b = 2;\n');
  await repo.write('scripts/run.sh', '#!/bin/sh\necho hi\n');
  await fs.chmod(path.join(repo.dir, 'scripts/run.sh'), 0o755);
  await fs.symlink('README.md', path.join(repo.dir, 'link.md'));
  await repo.write('space name/odd file.txt', 'odd\n');
  return repo.commitAll('base');
}

/** A second commit exercising edit/add/delete/mode-flip/symlink-add. */
async function seedChange(repo: Repo): Promise<string> {
  await repo.write('src/a.ts', 'export const a = 42;\n'); // edit
  await repo.write('src/new/c.ts', 'export const c = 3;\n'); // add (new dir)
  await fs.rm(path.join(repo.dir, 'src/deep/nested/b.ts')); // delete (empties a dir)
  await fs.chmod(path.join(repo.dir, 'scripts/run.sh'), 0o644); // mode flip
  await fs.symlink('src/a.ts', path.join(repo.dir, 'link2.md')); // symlink add
  await repo.write('space name/odd file.txt', 'odd v2\n'); // exotic-path edit
  return repo.commitAll('change');
}

describe('incremental ref snapshot ≡ full ref snapshot (the byte-layer determinism invariant)', () => {
  it('overlaying the base→ref diff produces the byte-identical treeId of a cold full walk', async () => {
    const repo = await Repo.create('warpline-inc-');
    cleanups.push(repo.dir);
    const shaA = await seedBase(repo);
    const shaB = await seedChange(repo);

    // Cold full snapshots of both commits in a fresh store.
    const cold = await freshStore();
    cleanups.push(cold.root);
    const fullA = await snapshotRef(cold.store, shaA, { cwd: repo.dir });
    const fullB = await snapshotRef(cold.store, shaB, { cwd: repo.dir });

    // Incremental in a SEPARATE store: seed the base tree, then anchor on it.
    const inc = await freshStore();
    cleanups.push(inc.root);
    const baseTree = await snapshotRef(inc.store, shaA, { cwd: repo.dir });
    expect(baseTree).toBe(fullA); // full path is deterministic across stores
    const incB = await snapshotRef(inc.store, shaB, { cwd: repo.dir }, { ref: shaA, treeId: baseTree });
    expect(incB).toBe(fullB); // ← the headline invariant

    // And the incremental tree is fully materializable from its own store
    // (every reused subtree + every overlaid blob is present).
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-inc-restore-'));
    cleanups.push(dest);
    expect(() => restoreTree(inc.store, incB, dest)).not.toThrow();
    expect((await fs.readFile(path.join(dest, 'src/a.ts'), 'utf8'))).toBe('export const a = 42;\n');
    await expect(fs.stat(path.join(dest, 'src/deep/nested/b.ts'))).rejects.toThrow(); // delete applied
  });

  it('actually TAKES the incremental path when anchored (unchanged blobs are never re-read/re-written)', async () => {
    // Fail-open makes a broken incremental path invisible to pure treeId-equality
    // tests (the full walk silently rescues it). Detect the path taken via a store
    // side-effect: delete an UNCHANGED file's loose blob after the base snapshot —
    // the incremental overlay never touches unchanged blobs, while the full walk
    // would re-write it (putBlob on every entry). Missing after ⇒ incremental ran.
    const repo = await Repo.create('warpline-inc-path-');
    cleanups.push(repo.dir);
    const shaA = await seedBase(repo);
    const shaB = await seedChange(repo);
    const { store, root } = await freshStore();
    cleanups.push(root);
    const baseTree = await snapshotRef(store, shaA, { cwd: repo.dir });

    const readmeBlob = blobId(Buffer.from('hello\n')); // README.md — unchanged in shaB
    const hex = readmeBlob.slice('blob:v1:'.length);
    const loose = path.join(root, '.warpline', 'objects', 'blobs', hex.slice(0, 2), hex.slice(2));
    await fs.rm(loose); // simulate: unchanged blob absent
    const incB = await snapshotRef(store, shaB, { cwd: repo.dir }, { ref: shaA, treeId: baseTree });
    await expect(fs.stat(loose)).rejects.toThrow(); // ← incremental path proof

    // And the treeId still matches a cold full snapshot (identity is entry-based).
    const cold = await freshStore();
    cleanups.push(cold.root);
    expect(incB).toBe(await snapshotRef(cold.store, shaB, { cwd: repo.dir }));
  });

  it('anchoring a snapshot on ITSELF is a no-op that returns the anchor tree', async () => {
    const repo = await Repo.create('warpline-inc-self-');
    cleanups.push(repo.dir);
    const sha = await seedBase(repo);
    const { store, root } = await freshStore();
    cleanups.push(root);
    const full = await snapshotRef(store, sha, { cwd: repo.dir });
    const self = await snapshotRef(store, sha, { cwd: repo.dir }, { ref: sha, treeId: full });
    expect(self).toBe(full);
  });

  it('T-033 parity: tracked .warpline/ paths are filtered identically on both paths', async () => {
    const repo = await Repo.create('warpline-inc-t033-');
    cleanups.push(repo.dir);
    await repo.write('src/a.ts', 'export const a = 1;\n');
    await repo.write('.warpline/fabric.jsonl', '{"seq":0}\n'); // the repo TRACKS its ledger
    const shaA = await repo.commitAll('base');
    await repo.write('src/a.ts', 'export const a = 2;\n');
    await repo.write('.warpline/fabric.jsonl', '{"seq":0}\n{"seq":1}\n'); // ledger changed too
    await repo.write('.warpline/refs/selvage', 'state:v0:x\n'); // and a .warpline ADD
    const shaB = await repo.commitAll('change');

    const cold = await freshStore();
    cleanups.push(cold.root);
    const fullB = await snapshotRef(cold.store, shaB, { cwd: repo.dir });

    const inc = await freshStore();
    cleanups.push(inc.root);
    const baseTree = await snapshotRef(inc.store, shaA, { cwd: repo.dir });
    const incB = await snapshotRef(inc.store, shaB, { cwd: repo.dir }, { ref: shaA, treeId: baseTree });
    expect(incB).toBe(fullB);
    // Neither contains a .warpline entry at the root.
    const rootEntries = inc.store.getTree(incB).map((e) => e.name);
    expect(rootEntries).not.toContain('.warpline');
    expect(rootEntries).toContain('src');
  });

  it('fails OPEN to the full walk when the anchor tree is absent from the store', async () => {
    const repo = await Repo.create('warpline-inc-open-');
    cleanups.push(repo.dir);
    const shaA = await seedBase(repo);
    const shaB = await seedChange(repo);
    const { store, root } = await freshStore();
    cleanups.push(root);
    const bogus = { ref: shaA, treeId: 'tree:v1:' + '0'.repeat(64) }; // never stored
    const viaBogus = await snapshotRef(store, shaB, { cwd: repo.dir }, bogus);
    const cold = await freshStore();
    cleanups.push(cold.root);
    expect(viaBogus).toBe(await snapshotRef(cold.store, shaB, { cwd: repo.dir }));
  });
});

describe('strandSnapshotAnchor — the verification gate', () => {
  const strandFor = (over: Partial<Strand>): Strand =>
    ({
      schemaVersion: 2,
      seq: 0,
      pickId: 'pick:v2:test',
      stateId: 'state:v0:test',
      parentStateId: null,
      actor: 't',
      intent: 't',
      recordedAt: 'now',
      objectCount: 0,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'x', treeSha: null, gitCommit: null },
      ...over,
    }) as Strand;

  it('accepts only a non-merge, gitOid-verified, store-present binding — rejects each broken leg', async () => {
    const repo = await Repo.create('warpline-inc-anchor-');
    cleanups.push(repo.dir);
    const sha = await seedBase(repo);
    const treeSha = await revParseTree(sha, { cwd: repo.dir });
    const { store, root } = await freshStore();
    cleanups.push(root);
    const treeId = await snapshotRef(store, sha, { cwd: repo.dir });

    const good = strandFor({
      binding: { treeId, gitOid: treeSha },
      provenance: { ref: 'main', treeSha, gitCommit: sha },
    });
    expect(await strandSnapshotAnchor(good, store, { cwd: repo.dir })).toEqual({ ref: sha, treeId });

    // merge strand: its gitCommit is one parent, never the merged tree → rejected
    expect(await strandSnapshotAnchor({ ...good, merged: true }, store, { cwd: repo.dir })).toBeUndefined();
    // worktree/backfilled seal (gitOid null) → rejected
    expect(
      await strandSnapshotAnchor(strandFor({ ...good, binding: { treeId, gitOid: null } }), store, { cwd: repo.dir }),
    ).toBeUndefined();
    // gitOid does not match the commit's tree (rewritten/wrong ref) → rejected
    expect(
      await strandSnapshotAnchor(
        strandFor({ ...good, binding: { treeId, gitOid: '0'.repeat(40) } }),
        store,
        { cwd: repo.dir },
      ),
    ).toBeUndefined();
    // native tree missing from the store → rejected
    expect(
      await strandSnapshotAnchor(
        strandFor({ ...good, binding: { treeId: 'tree:v1:' + 'f'.repeat(64), gitOid: treeSha } }),
        store,
        { cwd: repo.dir },
      ),
    ).toBeUndefined();
    // no strand at all → undefined
    expect(await strandSnapshotAnchor(undefined, store, { cwd: repo.dir })).toBeUndefined();
  });
});

describe('catFileBatch / diffRaw — the batched git plumbing', () => {
  it('returns byte-faithful blobs for many shas in one process, and fails closed on a missing object', async () => {
    const repo = await Repo.create('warpline-inc-batch-');
    cleanups.push(repo.dir);
    await seedBase(repo);
    const lines = (await repo.git('ls-tree', '-r', 'HEAD')).split('\n');
    const shaOf = new Map(lines.map((l) => [l.split('\t')[1], l.split(/\s+/)[2]]));
    const blobs = await catFileBatch([...shaOf.values()], { cwd: repo.dir });
    expect(blobs.get(shaOf.get('README.md')!)!.toString('utf8')).toBe('hello\n');
    expect(blobs.get(shaOf.get('link.md')!)!.toString('utf8')).toBe('README.md'); // symlink blob IS the target
    await expect(catFileBatch(['0'.repeat(40)], { cwd: repo.dir })).rejects.toThrow(/missing/);
  });

  it('diffRaw reports full shas, modes, and single-letter statuses with renames decomposed', async () => {
    const repo = await Repo.create('warpline-inc-diffraw-');
    cleanups.push(repo.dir);
    const shaA = await seedBase(repo);
    await fs.rename(path.join(repo.dir, 'src/a.ts'), path.join(repo.dir, 'src/renamed.ts'));
    const shaB = await repo.commitAll('rename');
    const raw = await diffRaw(shaA, shaB, { cwd: repo.dir });
    const byPath = new Map(raw.map((e) => [e.path, e]));
    expect(byPath.get('src/a.ts')?.status).toBe('D'); // --no-renames: delete…
    expect(byPath.get('src/renamed.ts')?.status).toBe('A'); // …plus add
    expect(byPath.get('src/renamed.ts')?.newSha).toMatch(/^[0-9a-f]{40}$/); // --full-index
  });
});

describe('end-to-end: an anchored FAST_ADMIT binds the identical treeId a cold snapshot computes', () => {
  it('admit(ref) after a genesis ref-pick takes the incremental path and matches cold-full', async () => {
    const repo = await Repo.create('warpline-inc-e2e-');
    cleanups.push(repo.dir);
    await repo.write('src/mod.ts', 'export function a() { return 1; }\n');
    await repo.commitAll('base');

    // Genesis: ref pick at base (binds a verified anchor: gitOid = base tree sha).
    const pick = await recordPick(repo.dir, { ref: 'HEAD' });
    expect(pick.strand?.binding?.gitOid).toBeTruthy();

    // Agent forks, edits, commits, admits its COMMIT (the dogfood shape).
    forkScratch(repo.dir, 'agent-x');
    await repo.write('src/mod.ts', 'export function a() { return 42; }\n');
    const shaB = await repo.commitAll('agent edit');
    const res = await admit(repo.dir, { agentId: 'agent-x', ref: shaB });
    expect(res.decision.status).toBe('FAST_ADMIT');
    expect(res.sealed).toBe(true);

    // The sealed binding must equal a COLD full snapshot of the same commit.
    const cold = await freshStore();
    cleanups.push(cold.root);
    expect(res.strand?.binding?.treeId).toBe(await snapshotRef(cold.store, shaB, { cwd: repo.dir }));
    // Sanity: the admitted commit resolves (repo untouched by the snapshot path).
    expect(await revParse('HEAD', { cwd: repo.dir })).toBe(shaB);
  });
});

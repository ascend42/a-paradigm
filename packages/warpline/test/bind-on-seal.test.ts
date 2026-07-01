/**
 * bind-on-seal.test — M1b (T-2026-07-01-011): every sealed strand carries a native
 * byte binding, and a materialized CLEAN merge is durably recoverable + re-derivable.
 *
 *   - a normal pick stamps binding.treeId; restoring it reproduces the tree git-absent
 *   - snapshotRef(HEAD) == snapshotDir(worktree) == strand.binding.treeId (faithful walk)
 *   - binding/merge are EXCLUDED from pickId (stamping them never moves the address)
 *   - a CLEAN merge seals binding + a MergeRecipe (3 native parent trees + result),
 *     and restoring recipe.result yields the merged bytes (compositional, A2)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { computePickId, type Strand } from '../src/fabric/strand.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir, snapshotRef, restoreTree } from '../src/warp/snapshot.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'b@warpline.test');
    await r.git('config', 'user.name', 'Warpline B');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (await execFileAsync('git', a, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

describe('bind-on-seal — a normal pick is byte-recoverable from the native store', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await Repo.create('warpline-bind-pick-');
    await repo.write('readme.md', 'hello\n');
    await repo.write('src/mod.ts', 'export const x = 1;\n');
    await repo.commitAll('base');
  }, 120_000);
  afterAll(async () => {
    await repo?.destroy();
  });

  it('stamps binding.treeId, and it equals snapshotRef(HEAD) == snapshotDir(worktree)', async () => {
    const res = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(res.strand?.binding?.treeId).toBeTruthy();
    const store = new ObjectStore(repo.dir);
    const viaRef = await snapshotRef(store, 'HEAD', { cwd: repo.dir });
    const viaDir = snapshotDir(store, repo.dir).treeId; // .git/.warpline are skipped
    expect(viaRef).toBe(res.strand!.binding!.treeId);
    expect(viaDir).toBe(res.strand!.binding!.treeId);
    // git tree provenance recorded as the shadow OID
    expect(res.strand!.binding!.gitOid).toBe(await repo.git('rev-parse', 'HEAD^{tree}'));
  });

  it('restore reproduces the picked tree byte-identically with git ABSENT', async () => {
    const store = new ObjectStore(repo.dir);
    const treeId = (await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 're-pick' })).strand?.binding?.treeId
      ?? snapshotDir(store, repo.dir).treeId;
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-bind-restore-'));
    try {
      restoreTree(store, treeId, out);
      expect(fs.readFileSync(path.join(out, 'readme.md'), 'utf8')).toBe('hello\n');
      expect(fs.readFileSync(path.join(out, 'src', 'mod.ts'), 'utf8')).toBe('export const x = 1;\n');
    } finally {
      await fsp.rm(out, { recursive: true, force: true });
    }
  });
});

describe('binding/merge are excluded from pickId', () => {
  it('adding a binding never changes the strand content-address', () => {
    const body: Omit<Strand, 'pickId'> = {
      schemaVersion: 1,
      seq: 3,
      stateId: 'state:v0:abc',
      parentStateId: 'state:v0:def',
      actor: 'tester',
      intent: 'x',
      recordedAt: '2026-07-01T00:00:00.000Z',
      objectCount: 5,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'HEAD', treeSha: 'deadbeef', gitCommit: 'cafef00d' },
    };
    const bare = computePickId(body);
    const bound = computePickId({ ...body, binding: { treeId: 'tree:v1:abc', gitOid: 'deadbeef' } });
    const merged = computePickId({
      ...body,
      binding: { treeId: 'tree:v1:res', gitOid: null },
      merge: { base: 'tree:v1:b', ours: 'tree:v1:o', theirs: 'tree:v1:t', result: 'tree:v1:res' },
    });
    expect(bound).toBe(bare);
    expect(merged).toBe(bare);
  });
});

describe('durable merge bytes — a CLEAN merge is recoverable + re-derivable', () => {
  let repo: Repo;
  const MOD = 'src/mod.ts';
  beforeAll(async () => {
    repo = await Repo.create('warpline-bind-merge-');
    await repo.write(MOD, 'export function a() { return 1; }\nexport function b() { return 2; }\n');
    await repo.commitAll('base');
    for (const [name, body] of [
      ['branchA', 'export function a() { return 10; }\nexport function b() { return 2; }\n'],
      ['branchB', 'export function a() { return 1; }\nexport function b() { return 20; }\n'],
    ] as const) {
      await repo.git('checkout', '-q', 'base');
      await repo.git('checkout', '-q', '-b', name);
      await repo.write(MOD, body);
      await repo.commitAll(name);
    }
    await repo.git('checkout', '-q', 'base');
  }, 120_000);
  afterAll(async () => {
    await repo?.destroy();
  });

  it('B admits CLEAN + sealed with binding + a 3-parent recipe; result restores both edits', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    forkScratch(root, 'B');

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');
    expect(ra.strand?.binding?.treeId).toBeTruthy(); // FAST_ADMIT is bound too

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    const recipe = rb.strand?.merge;
    expect(recipe).toBeTruthy();
    for (const k of ['base', 'ours', 'theirs', 'result'] as const) {
      expect(recipe![k]).toMatch(/^tree:v1:/); // all parents + result are native treeIds (A3)
    }
    expect(rb.strand?.binding?.treeId).toBe(recipe!.result);

    // Restore the merged RESULT from the native store — the merge Warpline performed,
    // recovered with git absent, carrying BOTH concurrent edits.
    const store = new ObjectStore(root);
    const out = await fsp.mkdtemp(path.join(os.tmpdir(), 'warpline-merge-restore-'));
    try {
      restoreTree(store, recipe!.result, out);
      const merged = fs.readFileSync(path.join(out, MOD), 'utf8');
      expect(merged).toContain('return 10;'); // A's edit
      expect(merged).toContain('return 20;'); // B's edit
    } finally {
      await fsp.rm(out, { recursive: true, force: true });
    }
  });
});

/**
 * admit-h1-relax.test — the H1 v2-relaxation (PR-B), guardrail-limited.
 *
 * The one-merge-generation wall is relaxed: a MERGE strand may now be the base or
 * theirs of a SUBSEQUENT admit, reconstructed from its DURABLE binding.treeId (the
 * merged bytes an earlier CLEAN admit content-addressed) instead of failing closed
 * on its single-parent commit. Proven here on a 3-agent scenario:
 *
 *   A⋈B land a merge strand M, then C admits against M as THEIRS →
 *     - C CLEAN-SEALS a well-formed 3rd-generation merge (was: KNOT-downgrade),
 *     - the merge uses M.binding.treeId (native store), not M's git commit,
 *     - the result is MATERIALIZABLE (restores byte-faithfully) and VERIFIABLE.
 *
 * Genuine-fail guardrail: a merge strand whose durable bytes are ABSENT still fails
 * CLOSED — the relaxation only trusts a merge strand with a present binding.treeId.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { restoreTree } from '../src/warp/snapshot.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'h1@warpline.test');
    await r.git('config', 'user.name', 'Warpline H1');
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
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

const MOD = 'src/mod.ts';

/** Three concurrent branches off `base`: A edits a, B edits b (CLEAN with A), C adds c. */
async function threeBranchRepo(prefix: string): Promise<Repo> {
  const repo = await Repo.create(prefix);
  await repo.write(MOD, `export function a() { return 1; } export function b() { return 2; }\n`);
  await repo.commitAll('base');
  for (const [name, body] of [
    ['branchA', `export function a() { return 10; } export function b() { return 2; }\n`],
    ['branchB', `export function a() { return 1; } export function b() { return 20; }\n`],
    ['branchC', `export function a() { return 1; } export function b() { return 2; }\nexport function c() { return 3; }\n`],
  ] as const) {
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', name);
    await repo.write(MOD, body);
    await repo.commitAll(name);
  }
  await repo.git('checkout', '-q', 'base');
  return repo;
}

/** Land A (FAST_ADMIT) then B (CLEAN merge strand M). Returns the admit results. */
async function landAB(root: string): Promise<{ ra: Awaited<ReturnType<typeof admit>>; rb: Awaited<ReturnType<typeof admit>> }> {
  await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
  forkScratch(root, 'B');
  forkScratch(root, 'C'); // C forks at genesis too — true 3-way concurrency
  const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
  const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
  return { ra, rb };
}

describe('H1 relaxation — a 3rd agent CLEAN-seals off a merge strand’s durable bytes', () => {
  let repo: Repo;
  beforeEach(async () => {
    repo = await threeBranchRepo('warpline-h1relax-');
  }, 120_000);
  afterEach(async () => repo?.destroy());

  it('A⋈B lands M; C admits against M and CLEAN-seals a verifiable 3rd-generation merge', async () => {
    const root = repo.dir;
    const { ra, rb } = await landAB(root);
    expect(ra.decision.status).toBe('FAST_ADMIT');
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.strand?.merged).toBe(true);
    const M = rb.strand!;

    // C re-bases onto M (theirs = a merge strand). RELAXED: reconstruct M's second
    // parent from M.binding.treeId → CLEAN-seal, never a KNOT-downgrade.
    const rc = await admit(root, { cwd: root, agentId: 'C', ref: 'branchC' });
    expect(rc.decision.status).toBe('CLEAN');
    expect(rc.sealed).toBe(true);
    expect(rc.strand?.merged).toBe(true);
    const C = rc.strand!;

    // The relaxation used M's DURABLE tree as the `theirs` merge input, not its commit.
    expect(C.merge?.theirs).toBe(M.binding?.treeId);
    // Content-addressed: binding.treeId IS the recipe result (verify’s invariant).
    expect(C.binding?.treeId).toBe(C.merge?.result);
    // The second DAG parent is C’s fork base (the genesis strand).
    expect(C.mergeParentPickId).toBeTruthy();

    // MATERIALIZABLE: restore the sealed merged tree byte-faithfully (git absent).
    const store = new ObjectStore(root);
    const out = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-h1relax-restore-'));
    try {
      restoreTree(store, C.binding!.treeId, out);
      const merged = await fs.readFile(path.join(out, MOD), 'utf8');
      // A’s a→10, B’s b→20, and C’s new function c must ALL be present.
      expect(merged).toContain('return 10');
      expect(merged).toContain('return 20');
      expect(merged).toContain('function c()');
    } finally {
      await fs.rm(out, { recursive: true, force: true });
    }

    // VERIFIABLE: the whole fabric authenticates (recipe trees present + recompute,
    // merge.result === binding.treeId, chain + merge-parent resolve). Pure v2 → no
    // anchor required.
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.v2Chain.ok).toBe(true);
  });

  it('genuine-fail: a merge strand whose durable bytes are ABSENT still fails closed', async () => {
    const root = repo.dir;
    const { rb } = await landAB(root);
    expect(rb.strand?.merged).toBe(true);
    const M = rb.strand!;

    // Simulate the merged BYTES being gone (never bound / pruned): delete M’s root
    // binding tree object from the store. store.has(M.binding.treeId) is now false,
    // so the merge input is unreconstructable → admit must fail CLOSED (never guess).
    const treeId = M.binding!.treeId;
    const hex = treeId.slice(treeId.lastIndexOf(':') + 1);
    const objPath = path.join(root, '.warpline', 'objects', 'trees', hex.slice(0, 2), hex.slice(2));
    await fs.rm(objPath, { force: true });
    expect(new ObjectStore(root).has(treeId)).toBe(false);

    const rc = await admit(root, { cwd: root, agentId: 'C', ref: 'branchC' });
    expect(rc.decision.status).toBe('CLEAN'); // meaning still commutes…
    expect(rc.sealed).toBe(false); // …but the bytes can’t be reconstructed → fail closed
  });
});

/**
 * admit-agentid.test — schema-v2 attribution + the merge second parent (§6.4).
 *   - admit(agentId) stamps authoredBy.agentId, and it is IN the recomputed pickId.
 *   - a hook-path recordPick (no agentId) → authoredBy.agentId === null (human default).
 *   - a materialized CLEAN admit carries mergeParentPickId == the base strand's pickId
 *     and merge.algo === 'warpline-merge3-v1' (restored + folded into the v2 pickId).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';
import { computePickId } from '../src/fabric/strand.js';

const execFileAsync = promisify(execFile);

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'a@warpline.test');
    await r.git('config', 'user.name', 'Warpline A');
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

describe('admit — agentId round-trips into the authenticated pickId', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await Repo.create('warpline-agentid-');
    await repo.write('src/mod.ts', 'export function a() { return 1; }\n');
    await repo.commitAll('base');
  }, 120_000);
  afterAll(async () => repo?.destroy());

  it('admit(agentId:"arky") stamps authoredBy.agentId and it re-verifies in the pickId', async () => {
    const r = await admit(repo.dir, { cwd: repo.dir, agentId: 'arky', ref: 'HEAD' });
    expect(r.sealed).toBe(true);
    expect(r.strand!.authoredBy?.agentId).toBe('arky');
    const { pickId, ...body } = r.strand!;
    expect(computePickId(body)).toBe(pickId); // agentId is IN the identity
  });
});

describe('recordPick — the hook path (no agentId) defaults authoredBy.agentId to null', () => {
  let repo: Repo;
  beforeAll(async () => {
    repo = await Repo.create('warpline-agentid-null-');
    await repo.write('src/mod.ts', 'export function a() { return 1; }\n');
    await repo.commitAll('base');
  }, 120_000);
  afterAll(async () => repo?.destroy());

  it('a pick with no agentId seals authoredBy.agentId === null (human/git-commit default)', async () => {
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(r.strand!.authoredBy?.agentId).toBeNull();
    const { pickId, ...body } = r.strand!;
    expect(computePickId(body)).toBe(pickId);
  });
});

describe('admit CLEAN — carries mergeParentPickId + merge.algo', () => {
  let repo: Repo;
  const MOD = 'src/mod.ts';
  beforeAll(async () => {
    repo = await Repo.create('warpline-agentid-merge-');
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
  afterAll(async () => repo?.destroy());

  it('a materialized CLEAN admit sets mergeParentPickId == base strand pickId, algo pinned', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    const genesis = readFabric(warplineDirOf(root))[0];
    forkScratch(root, 'B'); // B forks at the genesis base

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.strand!.merge!.algo).toBe('warpline-merge3-v1');
    // the SECOND DAG parent is the base B forked from (the genesis strand)
    expect(rb.strand!.mergeParentPickId).toBe(genesis.pickId);
    // and both are folded INTO the authenticated pickId
    const { pickId, ...body } = rb.strand!;
    expect(computePickId(body)).toBe(pickId);
  });
});

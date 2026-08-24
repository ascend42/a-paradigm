/**
 * admit-seal.test — Phase-C v2 END-TO-END: two agents admit through the FABRIC
 * and it advances to the materialized merged state — where git conflicts.
 *
 * genesis(base) → forkScratch(B) at genesis → A admits branchA (FAST) → B admits
 * branchB (CLEAN re-base, materialized) → the selvage IS the both-edits state.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { absorb } from '../src/absorb.js';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { readSelvage, readFabric, warplineDirOf } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'seal@warpline.test');
    await r.git('config', 'user.name', 'Warpline Seal');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async file(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async branch(name: string, rel: string, body: string): Promise<void> {
    await this.git('checkout', '-q', 'base');
    await this.git('checkout', '-q', '-b', name);
    await this.file(rel, body);
    await this.commitAll(name);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

describe('ADMIT-SEAL — the fabric advances to the materialized merge (git conflicts)', () => {
  let repo: FixtureRepo;
  let abState: string;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-seal-');
    await repo.file(MOD, `export function foo() { return 1; } export function bar() { return 2; }\n`);
    await repo.commitAll('base');
    await repo.branch('branchA', MOD, `export function foo() { return 10; } export function bar() { return 2; }\n`);
    await repo.branch('branchB', MOD, `export function foo() { return 1; } export function bar() { return 20; }\n`);
    await repo.branch('branchAB', MOD, `export function foo() { return 10; } export function bar() { return 20; }\n`);
    await repo.git('checkout', '-q', 'base');
    abState = (await absorb('branchAB', { cwd: repo.dir })).stateId;
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('two agents converge: selvage == both-edits state, fabric depth 3', async () => {
    const root = repo.dir;
    // genesis from base
    const g = await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    expect(g.isGenesis).toBe(true);

    // B forks its scratch at genesis BEFORE A admits (true concurrency).
    forkScratch(root, 'B');

    // A admits branchA — selvage unadvanced ⇒ FAST_ADMIT, seals A.
    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');
    expect(ra.sealed).toBe(true);

    // B admits branchB — selvage advanced to A ⇒ CLEAN re-base, MATERIALIZED + sealed.
    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.merged?.conflicts).toEqual([]);

    // The fabric tip is now the correct both-edits state — Warpline PERFORMED the merge.
    expect(readSelvage(warplineDirOf(root))).toBe(abState);
    expect(rb.strand?.stateId).toBe(abState);
    expect(readFabric(warplineDirOf(root))).toHaveLength(3); // genesis, A, merged
  });
});

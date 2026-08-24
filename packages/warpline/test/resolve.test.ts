/**
 * resolve.test — Phase-C v3 KNOT COUNCIL. A genuine same-symbol conflict KNOTs;
 * a human resolves it; the resolution strand seals, advances the selvage, and
 * records the reasoning (decidedBy / reason / contended) git's merge can't keep.
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
import { resolveKnot } from '../src/fabric/resolve.js';
import { readSelvage, readFabric, warplineDirOf } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';
const FOO = `#code:${MOD}::foo`;

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'res@warpline.test');
    await r.git('config', 'user.name', 'Warpline Res');
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

describe('KNOT COUNCIL — a human resolution seals + records the reasoning', () => {
  let repo: FixtureRepo;
  let resolvedStateId: string;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-resolve-');
    await repo.file(MOD, `export function foo() { return 1; }\nexport function bar() { return 2; }\n`);
    await repo.commitAll('base');
    await repo.branch('branchA', MOD, `export function foo() { return 10; }\nexport function bar() { return 2; }\n`);
    await repo.branch('branchB', MOD, `export function foo() { return 20; }\nexport function bar() { return 2; }\n`);
    await repo.branch('resolved', MOD, `export function foo() { return 99; }\nexport function bar() { return 2; }\n`);
    await repo.git('checkout', '-q', 'base');
    resolvedStateId = (await absorb('resolved', { cwd: repo.dir })).stateId;
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('KNOT then resolve: selvage advances to the resolved state, reasoning recorded', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    forkScratch(root, 'B');

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('KNOT'); // both edited foo → genuine conflict
    expect(rb.sealed).toBe(false);

    // Human resolves: foo := 99, recording the contended symbol precisely via --ours.
    const res = await resolveKnot(root, {
      cwd: root,
      agentId: 'B',
      resolvedRef: 'resolved',
      reason: 'neither 10 nor 20 — settled on 99',
      decidedBy: 'alice',
      oursRef: 'branchB',
    });

    expect(res.strand.resolves).toBeDefined();
    expect(res.resolution.decidedBy).toBe('alice');
    expect(res.resolution.reason).toContain('99');
    expect(res.resolution.contended).toContain(FOO); // the genuine knot symbol
    expect(res.resolution.resolvedSymbols).toContain(FOO);

    // The fabric tip IS the resolved state; the knot strand is in history.
    expect(readSelvage(warplineDirOf(root))).toBe(resolvedStateId);
    expect(res.strand.stateId).toBe(resolvedStateId);
    expect(readFabric(warplineDirOf(root))).toHaveLength(3); // genesis, A, resolution
  });
});

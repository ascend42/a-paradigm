/**
 * materialize.test — Phase-C v2: Warpline PERFORMS the merge git conflicts on.
 *
 *   PROOF : A edits foo, B edits bar on the SAME line → git merge-tree CONFLICTS,
 *           but materializeMergedState produces a merged tree whose MEANING equals
 *           the hand-authored both-edits branch (foo=10 AND bar=20) — byte-correct,
 *           no conflict.
 *   GUARD : when both sides change the SAME token differently, the plan CONFLICTS
 *           and no state is materialized (never a silent wrong-merge).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { absorb } from '../src/absorb.js';
import { mergeTree } from '../src/git/git-exec.js';
import { computeMerge, materializeMergedState } from '../src/fabric/materialize.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'mat@warpline.test');
    await r.git('config', 'user.name', 'Warpline Mat');
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

describe('MATERIALIZE — Warpline performs the merge where git conflicts', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-mat-');
    await repo.file(MOD, `export function foo() { return 1; } export function bar() { return 2; }\n`);
    await repo.commitAll('base');
    await repo.branch('branchA', MOD, `export function foo() { return 10; } export function bar() { return 2; }\n`);
    await repo.branch('branchB', MOD, `export function foo() { return 1; } export function bar() { return 20; }\n`);
    // the hand-authored correct merge — the oracle for our materialization.
    await repo.branch('branchAB', MOD, `export function foo() { return 10; } export function bar() { return 20; }\n`);
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('git CONFLICTS on A vs B (same line, two edits)', async () => {
    const g = await mergeTree('branchA', 'branchB', { cwd: repo.dir });
    expect(g.conflicted).toBe(true);
  });

  it('computeMerge produces the byte-correct merged file, no conflicts', async () => {
    const plan = await computeMerge('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts).toEqual([]);
    expect(plan.files.get(MOD)!.content.toString('utf8')).toBe(
      'export function foo() { return 10; } export function bar() { return 20; }\n',
    );
  });

  it('THE HEADLINE — the materialized merged state equals the hand-authored both-edits branch', async () => {
    const { state, plan } = await materializeMergedState('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts).toEqual([]);
    expect(state).not.toBeNull();
    const ab = await absorb('branchAB', { cwd: repo.dir });
    // meaning-identity: the merge Warpline performed IS the correct both-edits tree.
    expect(state!.stateId).toBe(ab.stateId);
  });
});

describe('MATERIALIZE GUARD — a true overlap conflicts, no state produced', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-mat-guard-');
    await repo.file(MOD, `export function foo() { return 1; }\n`);
    await repo.commitAll('base');
    await repo.branch('branchA', MOD, `export function foo() { return 10; }\n`);
    await repo.branch('branchB', MOD, `export function foo() { return 20; }\n`);
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('both edit foo\'s return token differently → conflict, state null', async () => {
    const { state, plan } = await materializeMergedState('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts.length).toBeGreaterThan(0);
    expect(state).toBeNull();
  });
});

/**
 * multiwriter-admit.test — THE MULTI-WRITER PROOF (Phase C v1, decision-level).
 *
 * The headline Warpline exists for: two agents edit the SAME project concurrently
 * and CONVERGE where git CONFLICTS. Each agent forks a scratch at a shared base,
 * edits, and admits; the second admission re-bases against the first and the
 * protocol returns a verdict.
 *
 *   PROOF   : A edits `foo`, B edits `bar` on the SAME physical line (so git's
 *             3-way merge CONFLICTS). Different symbols ⇒ admit returns CLEAN —
 *             Warpline admits both concurrently where git cannot.
 *   KNOT    : A and B both edit `foo` differently ⇒ admit returns KNOT (a human
 *             DECIDE is required; the protocol does NOT silently auto-merge).
 *   LINKED  : the gate-rule confidence — a CLEAN admit whose changed sets are
 *             dependency-adjacent in-graph is 'linked' (trustworthy); a disjoint
 *             one is 'independent' (carries the false-AUTOFOLD blind-spot risk).
 *
 * v1 is the DECISION; materializing the merged bytes is v2.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { absorb } from '../src/absorb.js';
import { mergeTree } from '../src/git/git-exec.js';
import { admitDecision } from '../src/fabric/admit.js';
import type { WarpState } from '../src/warp/warp-state.js';

const execFileAsync = promisify(execFile);

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const repo = new FixtureRepo(dir);
    await repo.git('init', '-q', '-b', 'base');
    await repo.git('config', 'user.email', 'mw@warpline.test');
    await repo.git('config', 'user.name', 'Warpline MW');
    await repo.git('config', 'commit.gpgsign', 'false');
    return repo;
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
  async branch(name: string, from: string, rel: string, body: string): Promise<void> {
    await this.git('checkout', '-q', from);
    await this.git('checkout', '-q', '-b', name);
    await this.file(rel, body);
    await this.commitAll(name);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

const MOD = 'src/mod.ts';

describe('MULTI-WRITER PROOF — concurrent admit converges where git conflicts', () => {
  let repo: FixtureRepo;
  let base: WarpState;
  let a: WarpState;
  let b: WarpState;
  let gitConflicted: boolean;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-mw-proof-');
    // foo and bar on ONE physical line → any edit rewrites that line, so git's
    // 3-way merge of two different edits to it CONFLICTS.
    await repo.file(MOD, `export function foo() { return 1; } export function bar() { return 2; }\n`);
    await repo.commitAll('base');
    await repo.branch('branchA', 'base', MOD, `export function foo() { return 10; } export function bar() { return 2; }\n`);
    await repo.branch('branchB', 'base', MOD, `export function foo() { return 1; } export function bar() { return 20; }\n`);
    await repo.git('checkout', '-q', 'base');

    base = await absorb('base', { cwd: repo.dir });
    a = await absorb('branchA', { cwd: repo.dir });
    b = await absorb('branchB', { cwd: repo.dir });
    gitConflicted = (await mergeTree('branchA', 'branchB', { cwd: repo.dir })).conflicted;
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('GIT CONFLICTS — A and B rewrote the same line differently', () => {
    expect(gitConflicted).toBe(true);
  });

  it('FAST_ADMIT — the first agent admits directly (selvage has not advanced)', () => {
    // A admits against an unadvanced selvage (== base).
    const d = admitDecision(base, a, base);
    expect(d.status).toBe('FAST_ADMIT');
  });

  it('THE HEADLINE — B admits CLEAN after A, where git CONFLICTS', () => {
    // selvage has advanced to A; B re-bases against it.
    const d = admitDecision(base, b, a);
    expect(d.status).toBe('CLEAN');
    expect(d.knots).toEqual([]);
    expect(d.dangling).toEqual([]);
    // foo and bar are independent (no edge between them) ⇒ blind-spot-flagged.
    expect(d.confidence).toBe('independent');
    expect(d.rebasedOnto).toBe(a.stateId);
  });
});

describe('MULTI-WRITER KNOT — same-symbol concurrent edits require a decision', () => {
  let repo: FixtureRepo;
  let base: WarpState;
  let a: WarpState;
  let b: WarpState;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-mw-knot-');
    await repo.file(MOD, `export function foo() { return 1; }\nexport function bar() { return 2; }\n`);
    await repo.commitAll('base');
    // both edit foo, differently.
    await repo.branch('branchA', 'base', MOD, `export function foo() { return 10; }\nexport function bar() { return 2; }\n`);
    await repo.branch('branchB', 'base', MOD, `export function foo() { return 20; }\nexport function bar() { return 2; }\n`);
    await repo.git('checkout', '-q', 'base');
    base = await absorb('base', { cwd: repo.dir });
    a = await absorb('branchA', { cwd: repo.dir });
    b = await absorb('branchB', { cwd: repo.dir });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('B admits into a KNOT on foo — NOT silently merged', () => {
    const d = admitDecision(base, b, a);
    expect(d.status).toBe('KNOT');
    expect(d.knots.length).toBeGreaterThan(0);
    expect(d.confidence).toBeNull();
  });
});

describe('MULTI-WRITER LINKED — a CLEAN admit whose changed sets are dependency-adjacent', () => {
  let repo: FixtureRepo;
  let base: WarpState;
  let a: WarpState;
  let b: WarpState;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-mw-linked-');
    await repo.file(MOD, `export function bar() { return 2; }\nexport function pad() { return 0; }\n`);
    await repo.commitAll('base');
    // A ADDS `caller` that calls bar (new edge caller→bar). B edits bar's body.
    await repo.branch(
      'branchA',
      'base',
      MOD,
      `export function bar() { return 2; }\nexport function pad() { return 0; }\nexport function caller() { return bar(); }\n`,
    );
    await repo.branch('branchB', 'base', MOD, `export function bar() { return 99; }\nexport function pad() { return 0; }\n`);
    await repo.git('checkout', '-q', 'base');
    base = await absorb('base', { cwd: repo.dir });
    a = await absorb('branchA', { cwd: repo.dir });
    b = await absorb('branchB', { cwd: repo.dir });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('CLEAN with confidence=linked — caller→bar edge joins the two changed sets', () => {
    const d = admitDecision(base, a, b); // A (adds caller) re-bases onto B (edited bar)
    expect(d.status).toBe('CLEAN');
    expect(d.confidence).toBe('linked');
  });
});

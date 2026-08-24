/**
 * trust-escalation.test — P3 Lane A2 END-TO-END: the grades sidecar's FIRST
 * consumer (forge-spec §1d — the permission model IS the scrutiny policy).
 *
 * An independent-confidence CLEAN admit touching a symbol whose GRADED survival
 * (grades.jsonl; ≥ K_MIN_GRADED graded outcomes, min across touched symbols) is
 * below SURVIVAL_FLOOR is HELD — refused, unsealed, selvage unmoved, report
 * names the symbol + survival + n. `--accept-risk` overrides: seals AND records
 * the override in .warpline/grades-escalations.jsonl (G5). No sidecar / not
 * enough grades / healthy survival ⇒ behavior exactly as before the rule.
 *
 * Fixture shape mirrors admit-seal.test: genesis(base) → forkScratch(B) →
 * A admits branchA (FAST) → B admits branchB (independent CLEAN — where git
 * conflicts), with the sidecar seeded per scenario.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { readSelvage, readFabric, warplineDirOf } from '../src/fabric/fabric.js';
import { gradesPathOf, escalationsPathOf, listGradeEscalations, type GradeSidecarRow } from '../src/fabric/grade.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';
const BAR = `#code:${MOD}::bar`; // the symbol agent B touches

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'trust@warpline.test');
    await r.git('config', 'user.name', 'Warpline Trust');
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

/** genesis(base) → forkScratch(B) → A FAST-admits branchA. B is poised for an independent CLEAN. */
async function poisedRepo(prefix: string): Promise<FixtureRepo> {
  const repo = await FixtureRepo.create(prefix);
  // foo and bar on ONE physical line → git conflicts; warpline sees disjoint symbols.
  await repo.file(MOD, `export function foo() { return 1; } export function bar() { return 2; }\n`);
  await repo.commitAll('base');
  await repo.branch('branchA', MOD, `export function foo() { return 10; } export function bar() { return 2; }\n`);
  await repo.branch('branchB', MOD, `export function foo() { return 1; } export function bar() { return 20; }\n`);
  await repo.git('checkout', '-q', 'base');
  await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
  forkScratch(repo.dir, 'B');
  const ra = await admit(repo.dir, { cwd: repo.dir, agentId: 'A', ref: 'branchA' });
  expect(ra.decision.status).toBe('FAST_ADMIT');
  return repo;
}

/** Seed .warpline/grades.jsonl with `survived`/`overturned` graded outcomes for one symbol. */
async function seedGrades(root: string, symbol: string, survived: number, overturned: number): Promise<void> {
  const rows: GradeSidecarRow[] = [];
  let n = 0;
  for (let i = 0; i < survived; i++)
    rows.push({ at: 't', pickId: `pick:v0:seed-s${n++}`, outcome: 'survived', authoredSymbols: [symbol], overturnedSymbols: [] });
  for (let i = 0; i < overturned; i++)
    rows.push({ at: 't', pickId: `pick:v0:seed-o${n++}`, outcome: 'overturned', authoredSymbols: [symbol], overturnedSymbols: [symbol] });
  await fs.writeFile(gradesPathOf(root), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const repos: FixtureRepo[] = [];
afterAll(async () => {
  await Promise.all(repos.map((r) => r.destroy()));
});

describe('TRUST FLOOR — 1/4 graded survival HOLDS the independent-CLEAN; --accept-risk seals + records', () => {
  it('holds, reports the symbol, leaves the selvage unmoved; then overrides explicitly', async () => {
    const repo = await poisedRepo('warpline-trust-held-');
    repos.push(repo);
    const root = repo.dir;
    const selvageBefore = readSelvage(warplineDirOf(root));

    await seedGrades(root, BAR, 1, 3); // 1/4 survival — below the 0.5 floor, n ≥ 3

    // HELD: refused, unsealed, selvage unmoved, report names symbol + survival + n.
    const held = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(held.decision.status).toBe('HELD');
    expect(held.sealed).toBe(false);
    expect(held.strand).toBeUndefined();
    expect(held.escalation).toEqual({ symbol: BAR, survival: 0.25, graded: 4, floor: 0.5, kMin: 3, underlyingStatus: 'CLEAN' });
    expect(readSelvage(warplineDirOf(root))).toBe(selvageBefore);
    expect(readFabric(warplineDirOf(root))).toHaveLength(2); // genesis + A only
    expect(existsSync(escalationsPathOf(root))).toBe(false); // a refusal records NO override row

    // --accept-risk: seals the underlying CLEAN and records the override (G5).
    const sealed = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB', acceptRisk: true });
    expect(sealed.decision.status).toBe('CLEAN');
    expect(sealed.decision.confidence).toBe('independent');
    expect(sealed.sealed).toBe(true);
    expect(sealed.escalation).toEqual({ symbol: BAR, survival: 0.25, graded: 4, floor: 0.5, kMin: 3, underlyingStatus: 'CLEAN', acceptedRisk: true });
    expect(readSelvage(warplineDirOf(root))).not.toBe(selvageBefore);
    const overrides = listGradeEscalations(root);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ agentId: 'B', pickId: sealed.strand!.pickId, symbol: BAR, survival: 0.25, graded: 4, acceptedRisk: true });
  }, 120_000);
});

describe('TRUST FLOOR — healthy / insufficient evidence never holds', () => {
  it('3/3 survival: not held — seals exactly as before, no escalation artifacts', async () => {
    const repo = await poisedRepo('warpline-trust-healthy-');
    repos.push(repo);
    const root = repo.dir;
    await seedGrades(root, BAR, 3, 0); // 3/3 survival, n ≥ K

    const r = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(r.decision.status).toBe('CLEAN');
    expect(r.sealed).toBe(true);
    expect(r.escalation).toBeUndefined();
    expect(existsSync(escalationsPathOf(root))).toBe(false);
  }, 120_000);

  it('1/2 graded (n < K): not held — the floor needs K_MIN_GRADED outcomes first', async () => {
    const repo = await poisedRepo('warpline-trust-thin-');
    repos.push(repo);
    const root = repo.dir;
    await seedGrades(root, BAR, 1, 1); // 0.5… irrelevant: n=2 < 3

    const r = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(r.decision.status).toBe('CLEAN');
    expect(r.sealed).toBe(true);
    expect(r.escalation).toBeUndefined();
    expect(existsSync(escalationsPathOf(root))).toBe(false);
  }, 120_000);
});

describe('TRUST FLOOR — no sidecar ⇒ zero breakage (regression guard)', () => {
  it('a repo with no grades data behaves exactly as today', async () => {
    const repo = await poisedRepo('warpline-trust-nosidecar-');
    repos.push(repo);
    const root = repo.dir;
    expect(existsSync(gradesPathOf(root))).toBe(false);
    const filesBefore = readdirSync(warplineDirOf(root)).sort();
    const fabricBefore = readFileSync(path.join(warplineDirOf(root), 'fabric.jsonl'), 'utf8');

    const r = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(r.decision.status).toBe('CLEAN');
    expect(r.decision.confidence).toBe('independent');
    expect(r.sealed).toBe(true);
    expect(r.escalation).toBeUndefined();
    expect('escalation' in r).toBe(false); // the result shape is byte-identical, not just undefined-valued

    // No grade/escalation artifacts appear; the only .warpline changes are the seal itself.
    const filesAfter = readdirSync(warplineDirOf(root)).sort();
    expect(filesAfter).not.toContain('grades.jsonl');
    expect(filesAfter).not.toContain('grades-escalations.jsonl');
    expect(filesAfter.filter((f) => !filesBefore.includes(f)).every((f) => !f.startsWith('grades'))).toBe(true);
    expect(readFileSync(path.join(warplineDirOf(root), 'fabric.jsonl'), 'utf8').startsWith(fabricBefore)).toBe(true); // append-only
  }, 120_000);
});

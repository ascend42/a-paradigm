/**
 * r2-agent-gate.test — R2 mixed mode: THE GATE IS REAL FOR AGENT WRITES;
 * HUMANS KEEP THE GIT DOOR (loid-loops.md R2; T-2026-07-18-001).
 *
 * The mechanism: `gate.agentWrites: 'real'` in .warpline/config.json makes an
 * AGENT-ATTRIBUTED #pick (agentId present — CLI --agent / $WARPLINE_AGENT_ID,
 * incl. the auto-seal hook forwarding it) ENFORCE its admit verdict: a
 * would-not-seal verdict (KNOT / DANGLE / HELD / non-materializable CLEAN)
 * REFUSES the seal (PickGateRefusal), with `--accept-risk` as the recorded,
 * never-silent override. Human / unattributed picks are BYTE-IDENTICAL to R1.
 * (The `admit` verb needs no R2 routing: invoked non-shadow it already blocks
 * for real — this file covers the pick/auto-seal door, the one agents actually
 * write through today.)
 *
 * Pinned:
 *   - agent CLEAN/FAST_ADMIT under 'real' seals normally; the row records gate:'real'
 *   - agent KNOT under 'real' REFUSES: no strand, selvage unmoved, row recorded
 *   - --accept-risk seals through, row records overridden:true (never silent)
 *   - fail-CLOSED: corrupt config refuses an agent pick; the human pick still seals
 *   - the human door is byte-identical: same tree + same clock ⇒ the SAME
 *     fabric.jsonl bytes with and without the R2 gate enabled
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick, PickGateRefusal } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { readShadowVerdicts } from '../src/fabric/shadow.js';
import { configPathOf } from '../src/fabric/config.js';
import { warplineDirOf, readFabric, readSelvage } from '../src/fabric/fabric.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';

/** Deterministic commit clock — lets two repos produce IDENTICAL commit shas. */
const GIT_EPOCH = '2026-07-18T00:00:00Z';

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'r2@warpline.test');
    await r.git('config', 'user.name', 'Warpline R2');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...a: string[]): Promise<string> =>
    (
      await execFileAsync('git', a, {
        cwd: this.dir,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_DATE: GIT_EPOCH, GIT_COMMITTER_DATE: GIT_EPOCH },
      })
    ).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    await fsp.writeFile(full, body, 'utf8');
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  async branch(name: string, rel: string, body: string): Promise<void> {
    await this.git('checkout', '-q', 'base');
    await this.git('checkout', '-q', '-b', name);
    await this.write(rel, body);
    await this.commitAll(`${name} edit`);
    await this.git('checkout', '-q', 'base');
  }
  setConfig(cfg: unknown): void {
    fs.mkdirSync(path.join(this.dir, '.warpline'), { recursive: true });
    fs.writeFileSync(configPathOf(this.dir), JSON.stringify(cfg), 'utf8');
  }
  fabricLen = (): number => readFabric(warplineDirOf(this.dir)).length;
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

describe('R2 — the real gate for agent-attributed picks', () => {
  let repo: Repo;

  beforeAll(async () => {
    repo = await Repo.create('warpline-r2-gate-');
    await repo.write('.gitignore', '.warpline/\n');
    await repo.write(MOD, 'export function foo() { return 1; }\nexport function bar() { return 2; }\n');
    await repo.commitAll('base');
    await repo.branch('branchA', MOD, 'export function foo() { return 10; }\nexport function bar() { return 2; }\n');
    await repo.branch('branchB', MOD, 'export function foo() { return 20; }\nexport function bar() { return 2; }\n');
    // genesis on base — then agent K forks HERE (its verdicts compare against a
    // selvage that will advance past its fork point → organic KNOT).
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' });
    forkScratch(repo.dir, 'K');
    repo.setConfig({ gate: { agentWrites: 'real' } });
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it("agent CLEAN/FAST_ADMIT under 'real' seals normally; the row records the enforced gate", async () => {
    const before = repo.fabricLen();
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'branchA', agentId: 'K2' });
    expect(r.noop).toBe(false);
    expect(r.strand!.authoredBy?.agentId).toBe('K2');
    expect(repo.fabricLen()).toBe(before + 1);
    const rows = readShadowVerdicts(repo.dir);
    expect(rows.at(-1)?.gate).toBe('real');
    expect(rows.at(-1)?.wouldSeal).toBe(true);
    expect(rows.at(-1)?.overridden).toBeUndefined();
    // VACUITY AUDIT (C-9, 2026-08-01). This case is named "agent CLEAN/
    // FAST_ADMIT … seals normally", but K2 has NO scratch ref, so its base
    // FELL BACK to the selvage and `admitDecision` returned FAST_ADMIT
    // UNCONDITIONALLY — `wouldSeal:true` here was forced by construction and
    // could not have observed the gate evaluating anything. That is exactly the
    // FAST_ADMIT stratum C-9 found filling the live verdict stream. The
    // assertion is kept (the seal behaviour is real) and made HONEST: the row
    // now states which base produced it, so the forced case is legible instead
    // of masquerading as a passed gate. The genuinely evaluated arm is the KNOT
    // below (K, which forked) and test/pick-gate-contested.test.ts.
    expect(rows.at(-1)?.baseFrom).toBe('selvage');
  }, 120_000);

  it('agent KNOT under "real" REFUSES the seal: no strand, selvage unmoved, verdict on the record', async () => {
    // K forked at genesis; the selvage has since advanced to branchA (test above).
    // K's branchB changed foo DIFFERENTLY → contested → would-not-seal.
    const before = repo.fabricLen();
    const selvageBefore = readSelvage(warplineDirOf(repo.dir));
    const rowsBefore = readShadowVerdicts(repo.dir).length;

    await expect(recordPick(repo.dir, { cwd: repo.dir, ref: 'branchB', agentId: 'K' })).rejects.toThrow(
      PickGateRefusal,
    );
    await expect(recordPick(repo.dir, { cwd: repo.dir, ref: 'branchB', agentId: 'K' })).rejects.toThrow(
      /would not seal.*KNOT|KNOT/,
    );

    // the seal did NOT happen…
    expect(repo.fabricLen()).toBe(before);
    expect(readSelvage(warplineDirOf(repo.dir))).toBe(selvageBefore);
    // …but the ENFORCED verdicts are on the record
    const rows = readShadowVerdicts(repo.dir);
    expect(rows.length).toBe(rowsBefore + 2);
    expect(rows.at(-1)?.status).toBe('KNOT');
    expect(rows.at(-1)?.gate).toBe('real');
    expect(rows.at(-1)?.wouldSeal).toBe(false);
    expect(rows.at(-1)?.agentId).toBe('K');
    // …and THIS one was a real re-base judgment: K forked (line ~99), so the
    // base was its own, not the selvage. The pair of assertions is what makes
    // the two FAST_ADMIT/KNOT strata distinguishable on the stream (C-9).
    expect(rows.at(-1)?.baseFrom).toBe('scratch');
  }, 120_000);

  it('--accept-risk seals through the hold, and the override is recorded (never silent)', async () => {
    const before = repo.fabricLen();
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'branchB', agentId: 'K', acceptRisk: true });
    expect(r.noop).toBe(false);
    expect(repo.fabricLen()).toBe(before + 1);
    const row = readShadowVerdicts(repo.dir).at(-1);
    expect(row?.gate).toBe('real');
    expect(row?.wouldSeal).toBe(false);
    expect(row?.overridden).toBe(true);
  }, 120_000);

  it('fail-CLOSED: a corrupt config refuses an AGENT pick; the human pick still seals', async () => {
    fs.writeFileSync(configPathOf(repo.dir), '{ this is not json', 'utf8');
    await repo.git('checkout', '-q', 'base');
    await repo.write(MOD, 'export function foo() { return 99; }\nexport function bar() { return 2; }\n');
    await repo.commitAll('post-corruption edit');

    // agent: the gate mode is undeterminable ⇒ refuse (a corrupt toggle file
    // must not silently disable the real gate)
    await expect(recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', agentId: 'K2' })).rejects.toThrow(
      /cannot be read.*fails CLOSED|fail.*CLOSED|undeterminable/i,
    );

    // human: fail-SAFE, exactly as R1 pinned it — the seal goes through
    const before = repo.fabricLen();
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD' });
    expect(r.noop).toBe(false);
    expect(repo.fabricLen()).toBe(before + 1);
  }, 120_000);
});

describe('R2 — the human door is BYTE-IDENTICAL with and without the gate', () => {
  it('same tree + same clock ⇒ the same fabric.jsonl bytes, gate on or off', async () => {
    const NOW = '2026-07-18T00:00:00.000Z';
    const mk = async (withGate: boolean): Promise<{ fabric: string; repo: Repo }> => {
      const repo = await Repo.create(withGate ? 'warpline-r2-bytes-on-' : 'warpline-r2-bytes-off-');
      await repo.write('.gitignore', '.warpline/\n');
      await repo.write(MOD, 'export function f() { return 1; }\n');
      await repo.commitAll('base'); // deterministic sha (fixed git dates)
      if (withGate) repo.setConfig({ gate: { agentWrites: 'real' } });
      await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis', actor: 'human', now: NOW });
      const fabric = fs.readFileSync(path.join(warplineDirOf(repo.dir), 'fabric.jsonl'), 'utf8');
      return { fabric, repo };
    };
    const on = await mk(true);
    const off = await mk(false);
    try {
      expect(on.fabric).toBe(off.fabric); // byte-identical human seal
      expect(on.fabric.length).toBeGreaterThan(0);
      // and the gated repo recorded NO shadow rows for the human pick
      expect(readShadowVerdicts(on.repo.dir)).toHaveLength(0);
    } finally {
      await on.repo.destroy();
      await off.repo.destroy();
    }
  }, 120_000);
});

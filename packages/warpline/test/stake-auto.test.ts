/**
 * stake-auto.test — R2 auto-stake-on-seal ("the valve stakes every seal",
 * loid-loops.md R2; T-2026-07-18-001).
 *
 * Pinned:
 *   - default OFF: no `stake.auto` ⇒ seals never touch the valve
 *   - 'every-seal': a successful NON-SHADOW seal (#pick and #admit) triggers a
 *     best-effort stake; noop picks never do
 *   - 'daily': not due within 24h ⇒ no valve invocation at all (no audit spam);
 *     due ⇒ stakes
 *   - S4 still rules: enabled:false or a non-allowlisted ref ⇒ no invocation
 *   - FAILURE NEVER BLOCKS THE SEAL: a deny-list-refusing tree still seals its
 *     pick; the refusal is audited by the valve itself
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { admit } from '../src/fabric/admit.js';
import { stakeAuditPathOf } from '../src/fabric/stake.js';
import type { StakeAuditRow } from '../src/fabric/stake.js';

const execFileAsync = promisify(execFile);
const MOD = 'src/mod.ts';

class Repo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<Repo> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new Repo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'auto@warpline.test');
    await r.git('config', 'user.name', 'Warpline Auto');
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
  setConfig(cfg: unknown): void {
    fs.mkdirSync(path.join(this.dir, '.warpline'), { recursive: true });
    fs.writeFileSync(path.join(this.dir, '.warpline', 'config.json'), JSON.stringify(cfg), 'utf8');
  }
  auditRows(): StakeAuditRow[] {
    const p = stakeAuditPathOf(this.dir);
    if (!fs.existsSync(p)) return [];
    return fs
      .readFileSync(p, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StakeAuditRow);
  }
  stakeTip = (): Promise<string | null> =>
    this.git('rev-parse', 'refs/heads/warpline-stakes').then(
      (s) => s,
      () => null,
    );
  stakeCount = (): Promise<string> => this.git('rev-list', '--count', 'refs/heads/warpline-stakes');
  destroy = (): Promise<void> => fsp.rm(this.dir, { recursive: true, force: true });
}

async function baseRepo(prefix: string): Promise<Repo> {
  const repo = await Repo.create(prefix);
  await repo.write('.gitignore', '.warpline/\n');
  await repo.write(MOD, 'export function f() { return 1; }\n');
  await repo.commitAll('base');
  return repo;
}

describe('R2 auto-stake-on-seal', () => {
  let repo: Repo | undefined;

  afterEach(async () => {
    await repo?.destroy();
    repo = undefined;
  });

  it('default: no stake.auto ⇒ a seal never invokes the valve', async () => {
    repo = await baseRepo('warpline-auto-off-');
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'] } }); // enabled but NO cadence
    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(r.noop).toBe(false);
    expect(await repo.stakeTip()).toBeNull();
    expect(repo.auditRows()).toHaveLength(0);
  }, 120_000);

  it("'every-seal': each non-noop pick stakes; noop picks do not; chain stays first-parent", async () => {
    repo = await baseRepo('warpline-auto-seal-');
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], auto: 'every-seal' } });

    const r1 = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(r1.noop).toBe(false);
    const tip1 = await repo.stakeTip();
    expect(tip1).not.toBeNull();
    expect(repo.auditRows().at(-1)?.action).toBe('stake');
    expect(repo.auditRows().at(-1)?.pickId).toBe(r1.strand!.pickId);

    // a NOOP pick (same meaning) never touches the valve
    const auditLenBefore = repo.auditRows().length;
    const rNoop = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'same again' });
    expect(rNoop.noop).toBe(true);
    expect(repo.auditRows()).toHaveLength(auditLenBefore);
    expect(await repo.stakeCount()).toBe('1');

    // an edit + seal cuts the next stake, first-parented on the previous one
    await repo.write(MOD, 'export function f() { return 2; }\n');
    await repo.commitAll('edit f');
    const r2 = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD' });
    expect(r2.noop).toBe(false);
    expect(await repo.stakeCount()).toBe('2');
    const tip2 = await repo.stakeTip();
    expect(await repo.git('log', '-1', '--format=%P', tip2!)).toBe(tip1);
    expect(repo.auditRows().at(-1)?.action).toBe('stake');
  }, 120_000);

  it("'daily': not due within 24h ⇒ NO valve invocation; due ⇒ stakes", async () => {
    repo = await baseRepo('warpline-auto-daily-');
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], auto: 'daily' } });
    const t0 = '2026-07-18T00:00:00.000Z';

    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis', now: t0 });
    expect(await repo.stakeCount()).toBe('1');
    const auditLen = repo.auditRows().length;

    // +1h: seal again — the valve is NOT invoked at all (no audit spam)
    await repo.write(MOD, 'export function f() { return 2; }\n');
    await repo.commitAll('edit f');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', now: '2026-07-18T01:00:00.000Z' });
    expect(await repo.stakeCount()).toBe('1');
    expect(repo.auditRows()).toHaveLength(auditLen);

    // +25h: due — the next seal stakes
    await repo.write(MOD, 'export function f() { return 3; }\n');
    await repo.commitAll('edit f again');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', now: '2026-07-19T01:00:00.000Z' });
    expect(await repo.stakeCount()).toBe('2');
    expect(repo.auditRows().at(-1)?.action).toBe('stake');
  }, 120_000);

  it('S4 still rules: auto with enabled:false, or a non-allowlisted ref ⇒ no invocation', async () => {
    repo = await baseRepo('warpline-auto-s4-');
    repo.setConfig({ stake: { enabled: false, refs: ['selvage'], auto: 'every-seal' } });
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(await repo.stakeTip()).toBeNull();
    expect(repo.auditRows()).toHaveLength(0);

    // enabled, cadence on, but selvage NOT allowlisted ⇒ checked BEFORE invoking
    repo.setConfig({ stake: { enabled: true, refs: ['some-other-ref'], auto: 'every-seal' } });
    await repo.write(MOD, 'export function f() { return 2; }\n');
    await repo.commitAll('edit f');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD' });
    expect(await repo.stakeTip()).toBeNull();
    expect(repo.auditRows()).toHaveLength(0); // no refuse-spam on every seal
  }, 120_000);

  it('failure never blocks the seal: a deny-refusing tree still seals; the refusal is audited', async () => {
    repo = await baseRepo('warpline-auto-fail-');
    await repo.write('ops/daemon-tokens.jsonl', '{}\n'); // a true leak in the tree
    await repo.commitAll('leaky');
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], auto: 'every-seal' } });

    const r = await recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'genesis' });
    expect(r.noop).toBe(false); // THE SEAL STANDS
    expect(r.strand).toBeDefined();
    expect(await repo.stakeTip()).toBeNull(); // no stake was cut
    const last = repo.auditRows().at(-1);
    expect(last?.action).toBe('refuse'); // …but the valve refusal is on the record
    expect(last?.reason).toMatch(/daemon-tokens\.jsonl/);
  }, 120_000);

  it("'every-seal' on the ADMIT path: a sealed non-shadow admission stakes; shadow never does", async () => {
    repo = await baseRepo('warpline-auto-admit-');
    // branchA edits f; selvage stays at base genesis
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(MOD, 'export function f() { return 10; }\n');
    await repo.commitAll('A edits f');
    await repo.git('checkout', '-q', 'base');
    await recordPick(repo.dir, { cwd: repo.dir, ref: 'base', intent: 'genesis' }); // no config yet ⇒ no stake
    repo.setConfig({ stake: { enabled: true, refs: ['selvage'], auto: 'every-seal' } });

    // SHADOW admit: sealed:false ⇒ the valve is never invoked
    const shadowRes = await admit(repo.dir, { cwd: repo.dir, agentId: 'A', ref: 'branchA', shadow: true });
    expect(shadowRes.sealed).toBe(false);
    expect(await repo.stakeTip()).toBeNull();

    // REAL admit: seals ⇒ stakes the advanced selvage
    const res = await admit(repo.dir, { cwd: repo.dir, agentId: 'A', ref: 'branchA' });
    expect(res.sealed).toBe(true);
    expect(await repo.stakeCount()).toBe('1');
    const last = repo.auditRows().at(-1);
    expect(last?.action).toBe('stake');
    expect(last?.pickId).toBe(res.strand!.pickId);
  }, 120_000);
});

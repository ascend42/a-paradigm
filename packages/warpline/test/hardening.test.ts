/**
 * hardening.test — audit fixes that keep the multi-writer path from silently
 * corrupting (Reviewer H3, H1).
 *   H3: a binary file changed on both sides FAILS CLOSED (conflict) instead of
 *       round-tripping through the UTF-8 text merge and corrupting bytes.
 *   H1: a 3rd agent re-basing onto a MERGE strand fails closed (no wrong base) —
 *       a merge strand's gitCommit is one parent and lacks the merged bytes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';
import { computeMerge } from '../src/fabric/materialize.js';

const execFileAsync = promisify(execFile);

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'h@warpline.test');
    await r.git('config', 'user.name', 'Warpline H');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string | Buffer): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }
  async commitAll(msg: string): Promise<void> {
    await this.git('add', '-A');
    await this.git('commit', '-q', '-m', msg);
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

describe('H3 — binary changed on both sides fails closed (no silent corruption)', () => {
  let repo: FixtureRepo;
  const BIN = 'asset.bin';

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-h3-');
    await repo.write(BIN, Buffer.from([0x00, 0x01, 0x02, 0x00, 0x03])); // NUL ⇒ binary
    await repo.commitAll('base');
    await repo.git('checkout', '-q', '-b', 'branchA');
    await repo.write(BIN, Buffer.from([0x00, 0x01, 0x09, 0x00, 0x03]));
    await repo.commitAll('A');
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'branchB');
    await repo.write(BIN, Buffer.from([0x00, 0x01, 0x07, 0x00, 0x03]));
    await repo.commitAll('B');
    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('computeMerge conflicts on the binary file — never a text merge', async () => {
    const plan = await computeMerge('base', 'branchA', 'branchB', { cwd: repo.dir });
    expect(plan.conflicts.some((c) => c.path === BIN && /binary/.test(c.reason))).toBe(true);
    expect(plan.files.has(BIN)).toBe(false); // not materialized
  });
});

describe('H1 — a 3rd agent re-basing onto a MERGE strand fails closed', () => {
  let repo: FixtureRepo;
  const MOD = 'src/mod.ts';

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-h1-');
    await repo.write(MOD, `export function a() { return 1; } export function b() { return 2; }\n`);
    await repo.commitAll('base');
    // A edits a, B edits b (same line) → CLEAN merge. C adds an independent c.
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
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('the merge strand is marked, and admitting onto it does not silently mis-base', async () => {
    const root = repo.dir;
    await recordPick(root, { cwd: root, ref: 'base', intent: 'genesis' });
    forkScratch(root, 'B');
    forkScratch(root, 'C'); // C also forks at genesis (true concurrency)

    const ra = await admit(root, { cwd: root, agentId: 'A', ref: 'branchA' });
    expect(ra.decision.status).toBe('FAST_ADMIT');

    const rb = await admit(root, { cwd: root, agentId: 'B', ref: 'branchB' });
    expect(rb.decision.status).toBe('CLEAN');
    expect(rb.sealed).toBe(true);
    expect(rb.strand?.merged).toBe(true); // the merge strand is marked

    // C re-bases onto the merge strand: meaning says CLEAN, but materializing
    // base/theirs off the merge strand's single-parent commit would mis-base →
    // fail CLOSED (unsealed), never a wrong 3rd-generation merge.
    const rc = await admit(root, { cwd: root, agentId: 'C', ref: 'branchC' });
    expect(rc.decision.status).toBe('CLEAN');
    expect(rc.sealed).toBe(false);
  });
});

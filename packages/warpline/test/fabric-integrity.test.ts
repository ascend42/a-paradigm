/**
 * fabric-integrity.test — the ledger fails CLOSED on corruption (Judge, blocking).
 *
 * A system that claims to be authoritative history must NEVER read a corrupt or
 * unreadable ledger/tip as "empty" — doing so lets admit fast-admit a fresh genesis
 * OVER real history (silent data loss). These tests pin the fail-closed contract:
 *   - readFabric: ENOENT ⇒ [] (genuinely empty); a malformed line ⇒ THROW (with position).
 *   - readSelvage: ENOENT ⇒ null (never sealed).
 *   - admit: a selvage that points at a state we cannot LOAD ⇒ THROW, never a
 *     silent fast-admit that orphans the existing tip.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { readFabric, readSelvage, appendStrand, warplineDirOf } from '../src/fabric/fabric.js';
import { admit } from '../src/fabric/admit.js';
import { recordPick } from '../src/fabric/pick.js';
import type { Strand } from '../src/fabric/strand.js';

const execFileAsync = promisify(execFile);

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-integrity-'));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'i@warpline.test');
    await r.git('config', 'user.name', 'Warpline I');
    await r.git('config', 'commit.gpgsign', 'false');
    return r;
  }
  git = async (...args: string[]): Promise<string> =>
    (await execFileAsync('git', args, { cwd: this.dir, encoding: 'utf8' })).stdout.trim();
  async write(rel: string, body: string): Promise<void> {
    const full = path.join(this.dir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body, 'utf8');
  }
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

const stubStrand = (seq: number, stateId: string): Strand => ({
  schemaVersion: 1,
  seq,
  pickId: `pick:v0:stub${seq}`,
  stateId,
  parentStateId: seq === 0 ? null : `state:v0:prev${seq}`,
  actor: 'tester',
  intent: 'stub',
  recordedAt: '2026-07-01T00:00:00.000Z',
  objectCount: 1,
  delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
  calibratedConfidence: null,
  provenance: { ref: 'HEAD', treeSha: null, gitCommit: null },
});

describe('readFabric — fails closed on a corrupt ledger, empty only when absent', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.create();
  });
  afterEach(async () => {
    await repo?.destroy();
  });

  it('a missing ledger reads as [] (genuinely empty)', () => {
    expect(readFabric(warplineDirOf(repo.dir))).toEqual([]);
  });

  it('a well-formed ledger parses in order', () => {
    const wdir = warplineDirOf(repo.dir);
    appendStrand(wdir, stubStrand(0, 'state:v0:a'));
    appendStrand(wdir, stubStrand(1, 'state:v0:b'));
    const fabric = readFabric(wdir);
    expect(fabric.map((s) => s.stateId)).toEqual(['state:v0:a', 'state:v0:b']);
  });

  it('a malformed line THROWS with its position — never silently drops history', async () => {
    const wdir = warplineDirOf(repo.dir);
    appendStrand(wdir, stubStrand(0, 'state:v0:a'));
    // Simulate a truncated/garbage append after a valid strand.
    await fs.appendFile(path.join(wdir, 'fabric.jsonl'), '{"seq":1,"stateId":"state:v0:b\n', 'utf8');
    expect(() => readFabric(wdir)).toThrowError(/corrupt at .*fabric\.jsonl:2/);
  });
});

describe('readSelvage — absent tip reads as null', () => {
  it('a missing selvage reads as null (never sealed)', async () => {
    const repo = await FixtureRepo.create();
    try {
      expect(readSelvage(warplineDirOf(repo.dir))).toBeNull();
    } finally {
      await repo.destroy();
    }
  });
});

describe('admit — a set tip we cannot load fails CLOSED (never orphans history)', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.create();
    await repo.write('src/mod.ts', 'export function a() { return 1; }\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'base');
  });
  afterEach(async () => {
    await repo?.destroy();
  });

  it('selvage points at a stateId with no loadable state → throws, does NOT fast-admit', async () => {
    // A tip exists on disk, but its state cache is absent (corruption / regen-gap).
    const wdir = warplineDirOf(repo.dir);
    await fs.mkdir(path.join(wdir, 'refs'), { recursive: true });
    await fs.writeFile(path.join(wdir, 'refs', 'selvage'), 'state:v0:ghosttip\n', 'utf8');

    await expect(
      admit(repo.dir, { cwd: repo.dir, agentId: 'X', ref: 'HEAD' }),
    ).rejects.toThrow(/selvage points at state:v0:ghosttip .* cannot be loaded/);
  });
});

describe('recordPick (T-029) — a set tip we cannot load fails CLOSED (never orphans history)', () => {
  let repo: FixtureRepo;
  beforeEach(async () => {
    repo = await FixtureRepo.create();
    await repo.write('src/mod.ts', 'export function a() { return 1; }\n');
    await repo.git('add', '-A');
    await repo.git('commit', '-q', '-m', 'base');
  });
  afterEach(async () => {
    await repo?.destroy();
  });

  it('selvage points at a stateId with no loadable state → recordPick throws, does NOT seal', async () => {
    // Symmetric with the admit fail-closed test: a SET tip whose state cache is
    // absent must NOT fall through and seal (which would orphan the real history).
    const wdir = warplineDirOf(repo.dir);
    await fs.mkdir(path.join(wdir, 'refs'), { recursive: true });
    await fs.writeFile(path.join(wdir, 'refs', 'selvage'), 'state:v0:ghosttip\n', 'utf8');

    await expect(
      recordPick(repo.dir, { cwd: repo.dir, ref: 'HEAD', intent: 'pick over a ghost tip' }),
    ).rejects.toThrow(/selvage points at state:v0:ghosttip .* cannot be loaded/);

    // Nothing was appended — the ledger stays empty rather than orphaning the tip.
    expect(readFabric(wdir)).toEqual([]);
  });
});

/**
 * merge-exotic-paths.test — C-2 regression: the merge must NOT silently drop
 * changes to a non-ASCII filename.
 *
 * `core.quotePath` defaults TRUE, so `git diff --name-only` (no `-z`) returns
 * `café.txt` as the octal-escaped literal `"caf\303\251.txt"`. That phantom path
 * enters the merge plan (all three sides read as absent → DELETE), the REAL file
 * never enters, and the merged tree therefore keeps the BASE version — zero
 * conflicts, sealed CLEAN. The VCS cardinal sin, on the default path.
 *
 * These tests pin the fix: `changedPaths` is NUL-delimited, and a NUL-delimited
 * path is never trimmed (a path may legitimately begin or end with a space).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { absorb } from '../src/absorb.js';
import { changedPaths } from '../src/git/git-exec.js';
import { computeMerge, materializeMergedState } from '../src/fabric/materialize.js';

const execFileAsync = promisify(execFile);

const ACCENT = 'src/café.ts';
const CJK = 'src/日本語.ts';
const SPACED = 'src/ leading-and-trailing .ts';
const PLAIN = 'src/plain.ts';

class FixtureRepo {
  constructor(public readonly dir: string) {}
  static async create(prefix: string): Promise<FixtureRepo> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    const r = new FixtureRepo(dir);
    await r.git('init', '-q', '-b', 'base');
    await r.git('config', 'user.email', 'mat@warpline.test');
    await r.git('config', 'user.name', 'Warpline Mat');
    await r.git('config', 'commit.gpgsign', 'false');
    // Left at its DEFAULT (true) deliberately — that default is the bug's trigger.
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
  destroy = (): Promise<void> => fs.rm(this.dir, { recursive: true, force: true });
}

const fn = (name: string, v: number): string => `export function ${name}() { return ${v}; }\n`;

describe('C-2 — a non-ASCII filename change survives the merge', () => {
  let repo: FixtureRepo;

  beforeAll(async () => {
    repo = await FixtureRepo.create('warpline-exotic-');
    await repo.file(ACCENT, fn('cafe', 1));
    await repo.file(CJK, fn('nihongo', 1));
    await repo.file(SPACED, fn('spaced', 1));
    await repo.file(PLAIN, fn('plain', 1));
    await repo.commitAll('base');

    // ours: changes ONLY the exotic-named files.
    await repo.git('checkout', '-q', '-b', 'ours');
    await repo.file(ACCENT, fn('cafe', 10));
    await repo.file(CJK, fn('nihongo', 10));
    await repo.file(SPACED, fn('spaced', 10));
    await repo.commitAll('ours');

    // theirs: changes only the ASCII-named file.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'theirs');
    await repo.file(PLAIN, fn('plain', 20));
    await repo.commitAll('theirs');

    // The hand-authored correct merge — the oracle for our materialization.
    await repo.git('checkout', '-q', 'base');
    await repo.git('checkout', '-q', '-b', 'oracle');
    await repo.file(ACCENT, fn('cafe', 10));
    await repo.file(CJK, fn('nihongo', 10));
    await repo.file(SPACED, fn('spaced', 10));
    await repo.file(PLAIN, fn('plain', 20));
    await repo.commitAll('oracle');

    await repo.git('checkout', '-q', 'base');
  }, 120_000);

  afterAll(async () => {
    await repo?.destroy();
  });

  it('changedPaths returns the REAL path, not the octal-escaped quoted literal', async () => {
    const paths = await changedPaths('base', 'ours', { cwd: repo.dir });
    expect(paths).toContain(ACCENT);
    expect(paths).toContain(CJK);
    // Nothing quoted or backslash-escaped may escape into the plan.
    expect(paths.some((p) => p.startsWith('"') || p.includes('\\'))).toBe(false);
  });

  it('a NUL-delimited path keeps its leading AND trailing spaces (never trimmed)', async () => {
    const paths = await changedPaths('base', 'ours', { cwd: repo.dir });
    expect(paths).toContain(SPACED);
  });

  it('THE CARDINAL SIN — the merged plan carries the CHANGED bytes, not the base version', async () => {
    const plan = await computeMerge('base', 'ours', 'theirs', { cwd: repo.dir });
    expect(plan.conflicts).toEqual([]);
    for (const p of [ACCENT, CJK, SPACED]) {
      const merged = plan.files.get(p);
      expect(merged, `${p} must be present in the merge plan`).toBeTruthy();
      expect(merged!.content.toString('utf8')).toContain('return 10;');
    }
    // and no phantom escaped path was planned (which would plan a DELETE).
    for (const key of plan.files.keys()) {
      expect(key.startsWith('"')).toBe(false);
    }
  });

  it('the materialized merged state equals the hand-authored oracle branch', async () => {
    const { state, plan } = await materializeMergedState('base', 'ours', 'theirs', { cwd: repo.dir });
    expect(plan.conflicts).toEqual([]);
    expect(state).not.toBeNull();
    const oracle = await absorb('oracle', { cwd: repo.dir });
    expect(state!.stateId).toBe(oracle.stateId);
  }, 120_000);
});

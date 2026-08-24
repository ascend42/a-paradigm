/**
 * oracle-contested-merge.test — the weave-clean guard (T-2026-06-25-005).
 *
 * Battle-test R2 (Jinx): when a symbol is BOTH a git conflict AND a meaning knot it
 * lands in agreeConflict, which counts as AGREEMENT — so the convergence verdict can
 * read CONVERGENT/score 1 over a merge git literally cannot complete. That's correct
 * for the AGREEMENT metric but misreads as "safe". The fix: a separate `mergeClean`
 * answer (no knots ∧ no dangling ∧ no git conflict) that is the actionable verdict —
 * a contested merge is NEVER mergeClean, regardless of how convergence scores.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { oracle } from '../src/oracle.js';

const exec = promisify(execFile);

let repo: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repo });
  return stdout.trim();
}
async function write(rel: string, body: string): Promise<void> {
  const full = path.join(repo, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
}

const add = (ret: string) => `export function add(a: number, b: number): number {\n  return ${ret};\n}\n`;

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-contested-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@warpline.test']);
  await git(['config', 'user.name', 'Warpline Fixture']);
  await git(['config', 'commit.gpgsign', 'false']);
  await write('src/math.ts', add('a + b'));
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'base']);
  const base = await git(['rev-parse', 'HEAD']);
  // two branches change add's body on the SAME line, divergently → git conflicts AND
  // meaning knots (both agree the symbol conflicts → agreeConflict).
  await git(['checkout', '-q', '-b', 'branch-x', base]);
  await write('src/math.ts', add('a + b + 1'));
  await git(['commit', '-qam', 'x: plus one']);
  await git(['checkout', '-q', '-b', 'branch-y', base]);
  await write('src/math.ts', add('a + b + 2'));
  await git(['commit', '-qam', 'y: plus two']);
  await git(['checkout', '-q', 'main']);
}, 60_000);

afterAll(async () => {
  if (repo) await fs.rm(repo, { recursive: true, force: true });
});

describe('oracle — a contested merge is never mergeClean (even if convergence agrees)', () => {
  it('reports mergeClean=false when git conflicts AND meaning knots on the same symbol', async () => {
    const rec = await oracle('branch-x', 'branch-y', { cwd: repo, noWrite: true });

    // both sides see the conflict: git conflicts on src/math.ts, meaning knots on add.
    expect(rec.gitReality.conflicted).toBe(true);
    expect(rec.prediction.knots.length).toBeGreaterThanOrEqual(1);

    // THE FIX: the actionable answer is CONFLICTED — never green — regardless of how
    // the convergence/agreement metric scores this "both-caught" case.
    expect(rec.mergeClean).toBe(false);
  });
});

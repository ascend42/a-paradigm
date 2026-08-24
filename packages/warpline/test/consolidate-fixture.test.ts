/**
 * consolidate-fixture.test — THE FALSIFIABLE MULTI-AGENT CLAIM (T-2026-06-24-012).
 *
 * Jinx's demand: prove `consolidate` reduces HUMAN labor vs `git merge` on CONTENDED
 * same-feature work — not the easy non-intersecting case. We build a throwaway repo
 * where FOUR branches all edit ONE function's single return line, so git conflicts on
 * every one, but two of the edits are MEANING-PRESERVING (alpha-equivalent param
 * renames → zero essence delta → auto-fold) and only two are genuinely divergent
 * (a real KNOT). Pre-registered metric: K_human (Warpline knots+dangles) < C_git
 * (sequential-merge conflicts a human must resolve). The claim PASSES iff K_human < C_git.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { consolidate } from '../src/consolidate.js';

const exec = promisify(execFile);

let repo: string;
let base: string;

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: repo });
  return stdout.trim();
}
async function writeMod(body: string): Promise<void> {
  await fs.writeFile(path.join(repo, 'mod.ts'), body);
}

// All four branches edit beta's single return line, so git collides on every pair.
const BASE = `export function beta(n: number): number {\n  return n + 1;\n}\n`;
// Meaning-preserving: alpha-equivalent param renames — CCNF normalizes → SAME essence.
const RENAME_A = `export function beta(a: number): number {\n  return a + 1;\n}\n`;
const RENAME_B = `export function beta(b: number): number {\n  return b + 1;\n}\n`;
// Genuinely divergent behavior — different essence → the real KNOT.
const CHANGE_X = `export function beta(n: number): number {\n  return n * 2;\n}\n`;
const CHANGE_Y = `export function beta(n: number): number {\n  return n + 100;\n}\n`;

const BRANCHES = ['rename-a', 'rename-b', 'change-x', 'change-y'] as const;

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-consolidate-fixture-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@warpline.test']);
  await git(['config', 'user.name', 'Warpline Fixture']);
  await git(['config', 'commit.gpgsign', 'false']);
  await writeMod(BASE);
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'base']);
  base = await git(['rev-parse', 'HEAD']);
  const bodies = { 'rename-a': RENAME_A, 'rename-b': RENAME_B, 'change-x': CHANGE_X, 'change-y': CHANGE_Y };
  for (const name of BRANCHES) {
    await git(['checkout', '-q', '-b', name, base]);
    await writeMod(bodies[name]);
    await git(['commit', '-qam', name]);
  }
  await git(['checkout', '-q', 'main']);
}, 60_000);

afterAll(async () => {
  if (repo) await fs.rm(repo, { recursive: true, force: true });
});

describe('consolidate — the contended same-feature fixture (T-2026-06-24-012)', () => {
  it('folds the meaning-preserving renames and surfaces ONLY the real knot', async () => {
    const f = await consolidate([...BRANCHES], { cwd: repo, base });

    // Exactly ONE decision: change-x vs change-y diverge on beta's body.
    expect(f.decisions).toBe(1);
    expect(f.knots).toHaveLength(1);
    const knot = f.knots[0];
    expect(knot.symbol).toContain('beta');
    expect(knot.conflictingSlots).toContain('body');
    // The tension is the two REAL changes — the renames are not in it.
    expect(knot.sides.map((s) => s.ref).sort()).toEqual(['change-x', 'change-y']);
    // The renames carried zero delta — nothing to fold, nothing to decide.
    expect(f.dangling).toHaveLength(0);
  });

  it('BEATS git: K_human < C_git on the same contended branches', async () => {
    // Warpline labor.
    const f = await consolidate([...BRANCHES], { cwd: repo, base });
    const kHuman = f.decisions;

    // git labor: sequentially merge every branch into a fresh integration branch and
    // count how many merges HALT with a textual conflict a human must resolve.
    await git(['checkout', '-q', '-B', 'integration', base]);
    let cGit = 0;
    for (const b of BRANCHES) {
      try {
        await git(['merge', '--no-edit', '--no-ff', b]);
      } catch {
        cGit++;
        await git(['merge', '--abort']);
      }
    }
    await git(['checkout', '-q', 'main']);

    // THE PRE-REGISTERED CLAIM: Warpline asks for fewer human decisions than git.
    expect(kHuman).toBe(1);
    expect(cGit).toBeGreaterThanOrEqual(2);
    expect(kHuman).toBeLessThan(cGit);
  });
});

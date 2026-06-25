/**
 * oracle-nonsymbol-conflict.test — the LIES-GREEN integration guard (T-2026-06-25-001).
 *
 * Found firsthand in the CLI battle-test: `oracle X main` reported CONVERGENT / score 1
 * while git's real merge CONFLICTED — because the conflict was in a NON-SYMBOL file
 * (README.md) that mapped to no symbol, so the conflict never entered the matrix.
 * This fixture builds exactly that: two branches that conflict ONLY in a root-level
 * README (no symbol there; the real symbol lives under src/). The oracle MUST report
 * the divergence (DIVERGENT, gitConflictUnmapped non-empty), never a green lie.
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

// A real symbol lives under src/ (so its dir is "src"); the conflict is at the ROOT
// (README.md), whose dir "" has no symbol → the conflict is git-only / unmapped.
const MOD = `export function beta(n: number): number {\n  return n + 1;\n}\n`;

beforeAll(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'warpline-nonsymbol-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@warpline.test']);
  await git(['config', 'user.name', 'Warpline Fixture']);
  await git(['config', 'commit.gpgsign', 'false']);
  await write('src/mod.ts', MOD);
  await write('README.md', 'line one\nline two\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'base']);
  const base = await git(['rev-parse', 'HEAD']);
  // Two branches that touch ONLY README's first line, divergently → git conflict,
  // zero meaning change (src/mod.ts untouched on both).
  await git(['checkout', '-q', '-b', 'branch-x', base]);
  await write('README.md', 'line one — X edit\nline two\n');
  await git(['commit', '-qam', 'x edits readme']);
  await git(['checkout', '-q', '-b', 'branch-y', base]);
  await write('README.md', 'line one — Y edit\nline two\n');
  await git(['commit', '-qam', 'y edits readme']);
  await git(['checkout', '-q', 'main']);
}, 60_000);

afterAll(async () => {
  if (repo) await fs.rm(repo, { recursive: true, force: true });
});

describe('oracle — git conflict in a non-symbol file must NOT read green', () => {
  it('reports DIVERGENT with the unmapped git conflict surfaced, not CONVERGENT', async () => {
    const rec = await oracle('branch-x', 'branch-y', { cwd: repo, noWrite: true });

    // git genuinely conflicts on README.md...
    expect(rec.gitReality.conflicted).toBe(true);
    // ...meaning is clean (neither branch touched a symbol)...
    expect(rec.prediction.knots).toHaveLength(0);
    expect(rec.prediction.dangling).toHaveLength(0);
    // ...and the conflict is surfaced as a git-only unmapped divergence, NOT swallowed.
    expect(rec.convergence.gitConflictUnmapped).toContain('README.md');
    // THE FIX: the verdict honours git reality — no green lie.
    expect(rec.convergence.verdict).toBe('DIVERGENT');
    expect(rec.convergence.score).toBeLessThan(1);
  });
});

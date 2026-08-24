/**
 * cli-cold-agent-cycle.test — the F4 legibility contract of the CLI write cycle.
 *
 * WHAT THIS DEFENDS. TD-2026-07-21-766 says an agent of ANY provider must be
 * able to use Warpline as easily as git, and that runtime self-description is
 * the ONLY mechanism (Warpline is unpublished, so it is in no model's weights).
 * The CLI failed that on its most important path, and failed it QUIETLY:
 *
 *   - `propose` marked `--claim` REQUIRED while the engine marks `intent`
 *     required and `claim` optional (native.ts: intent throws when missing,
 *     claim is `if (opts.claim)`). The daemon/MCP descriptor for the same verb
 *     had it right all along. So the CLI forced an agent to author
 *     `#code:<file>::<name>` symbol-id syntax — which the CLI never teaches —
 *     before it could capture ANY work.
 *   - `admit` after `fork`-without-`propose` returned NOOP "the agent changed
 *     no meaning", which is FALSE: the work is real and merely unsealed.
 *
 * These are asserted against the REAL BINARY because the defect lived in the
 * CLI's own option wiring and prose, which no library-level test can see.
 * The engine-side half is pinned in native-sequencing-refusals.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));

const MOD = 'src/mod.ts';
const BASE = 'export function foo(): number { return 1; }\n';
const EDIT = 'export function foo(): number { return 42; }\n';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

describe('#warpline-cli — a cold agent can complete fork → propose → admit from --help alone', () => {
  let root: string;
  let wt: string;

  // needs the built binary; skip gracefully on a src-only checkout.
  const haveDist = existsSync(distCli);

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-cold-'));
    wt = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-cold-wt-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, MOD), BASE, 'utf8');
  });

  afterAll(() => {
    for (const d of [root, wt]) fs.rmSync(d, { recursive: true, force: true });
  });

  /** Drive the real CLI; never throws on a refusing exit. */
  const cli = async (...args: string[]): Promise<Run> => {
    try {
      const { stdout, stderr } = await execFileAsync('node', [distCli, '--root', root, ...args], {
        cwd: root,
        encoding: 'utf8',
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  };

  it.skipIf(!haveDist)('seals a proposal with NO --claim — intent is the only requirement', async () => {
    expect((await cli('pick', '-m', 'genesis')).code).toBe(0);

    const forked = await cli('fork', 'cold', '--into', wt);
    expect(forked.code).toBe(0);
    fs.writeFileSync(path.join(wt, MOD), EDIT, 'utf8');

    // THE REGRESSION THIS FILE EXISTS FOR: no --claim, no symbol-id syntax.
    const proposed = await cli('propose', '--agent', 'cold', '--native', '--worktree', wt, '-m', 'cold: foo returns 42');
    expect(proposed.code).toBe(0);
    expect(proposed.stdout).toContain('SEALED');

    const admitted = await cli('admit', 'cold', '--native', '--worktree', wt);
    expect(admitted.code).toBe(0);
    expect(admitted.stdout).toMatch(/FAST_ADMIT|CLEAN/);
  }, 120_000);

  it.skipIf(!haveDist)('admit after fork-without-propose names the recovery verb, never "changed no meaning"', async () => {
    const wt2 = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-cold-wt2-'));
    try {
      expect((await cli('fork', 'forgetful', '--into', wt2)).code).toBe(0);
      fs.writeFileSync(path.join(wt2, MOD), 'export function foo(): number { return 7; }\n', 'utf8');

      const r = await cli('admit', 'forgetful', '--native', '--worktree', wt2);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('nothing PROPOSED');
      expect(r.stderr).toContain('warpline propose');
      // The false diagnosis must be gone, not merely accompanied.
      expect(r.stderr).not.toContain('changed no meaning');
      expect(r.stdout).not.toContain('NOOP');
      // refusal:v1 rides stderr so the recovery is machine-readable, not prose-only.
      expect(r.stderr).toContain('"code":"BAD_REQUEST"');
      // ONE `warpline: ` prefix — engine messages already carry their own.
      expect(r.stderr).not.toContain('warpline: warpline:');
    } finally {
      fs.rmSync(wt2, { recursive: true, force: true });
    }
  }, 120_000);

  it.skipIf(!haveDist)('claim-only mode (no --native) still requires --claim, and says why', async () => {
    const r = await cli('propose', '--agent', 'nobody');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('--claim is required');
    expect(r.stderr).toContain('--native');
  }, 60_000);

  it.skipIf(!haveDist)('--native with neither -m nor a claim intent refuses with the I3 reason', async () => {
    const r = await cli('propose', '--agent', 'nobody', '--native');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('intent is required');
    expect(r.stderr).toContain('I3');
  }, 60_000);

  it.skipIf(!haveDist)('the three cycle verbs number themselves in --help', async () => {
    for (const [verb, step] of [
      ['fork', 'CYCLE STEP 1'],
      ['propose', 'CYCLE STEP 2'],
      ['admit', 'CYCLE STEP 3'],
    ] as const) {
      const r = await cli(verb, '--help');
      expect(r.stdout, `${verb} --help must state its cycle position`).toContain(step);
    }
  }, 60_000);
});

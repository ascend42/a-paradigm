/**
 * bench/bench-admit.mts — END-TO-END admit benchmark on a THROWAWAY LOCAL CLONE
 * of this monorepo (T-2026-07-04-003 acceptance bar). Never touches the real
 * repo's live `.warpline/`: everything runs inside a temp clone that is deleted
 * afterwards. Not shipped (bench/ is outside tsup entry + `files`).
 *
 * Scenario (the Move-3 dogfood shape):
 *   1. GENESIS ref-pick at HEAD          — cold path: full absorb + FULL native snapshot
 *   2. agent-a edits → commit → admit    — warm path: FAST_ADMIT (anchored, incremental)
 *   3. agent-b (forked at the same base) edits a different file → commit → admit
 *                                        — warm path: CLEAN merge (materialize + captureMerge)
 *
 * Run from packages/warpline:
 *   ../../node_modules/.bin/tsx bench/bench-admit.mts
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordPick } from '../src/fabric/pick.js';
import { forkScratch } from '../src/fabric/scratch.js';
import { admit } from '../src/fabric/admit.js';

const execFileAsync = promisify(execFile);
// WARPLINE_BENCH_SOURCE lets a baseline-worktree copy of this script clone the
// same real repo (a linked worktree is not itself clonable with --local).
const SOURCE_REPO = process.env.WARPLINE_BENCH_SOURCE ?? path.resolve(import.meta.dirname, '..', '..', '..');

const sh = async (cwd: string, cmd: string, ...args: string[]): Promise<string> =>
  (await execFileAsync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = performance.now();
  const r = await fn();
  console.log(`${label}: ${((performance.now() - s) / 1000).toFixed(2)}s`);
  return r;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bench-admit-'));
const clone = path.join(tmp, 'clone');
try {
  console.log(`source: ${SOURCE_REPO}`);
  await sh(tmp, 'git', 'clone', '--quiet', '--local', '--no-hardlinks', SOURCE_REPO, clone);
  await sh(clone, 'git', 'config', 'user.email', 'bench@warpline.test');
  await sh(clone, 'git', 'config', 'user.name', 'Warpline Bench');
  await sh(clone, 'git', 'config', 'commit.gpgsign', 'false');
  // Fresh fabric: drop any tracked .warpline state and keep the store untracked.
  fs.rmSync(path.join(clone, '.warpline'), { recursive: true, force: true });
  fs.appendFileSync(path.join(clone, '.gitignore'), '\n.warpline/\n');
  await sh(clone, 'git', 'add', '-A');
  await sh(clone, 'git', 'commit', '-q', '-m', 'bench base (fresh fabric)');
  const files = Number(await sh(clone, 'bash', '-c', 'git ls-files | wc -l'));
  console.log(`clone ready — ${files} tracked files\n`);

  // 1. GENESIS (cold: full absorb + FULL snapshot — no anchor exists yet).
  await timed('[cold] genesis ref-pick (full absorb + FULL native snapshot)', () =>
    recordPick(clone, { ref: 'HEAD' }),
  );

  // 2+3. Fork both agents at the SAME selvage (the concurrent-writer shape).
  forkScratch(clone, 'agent-a');
  forkScratch(clone, 'agent-b');
  const base = await sh(clone, 'git', 'rev-parse', 'HEAD');

  // agent-a: edit + commit on a branch, admit the commit → FAST_ADMIT.
  await sh(clone, 'git', 'checkout', '-q', '-b', 'bench-a', base);
  fs.appendFileSync(
    path.join(clone, 'packages/warpline/src/justification.ts'),
    '\nexport function benchAgentA(): number { return 1; }\n',
  );
  await sh(clone, 'git', 'commit', '-q', '-am', 'bench: agent-a edit');
  const shaA = await sh(clone, 'git', 'rev-parse', 'HEAD');
  const ra = await timed('[warm] admit agent-a (FAST_ADMIT, anchored incremental snapshot)', () =>
    admit(clone, { agentId: 'agent-a', ref: shaA }),
  );
  console.log(`  → ${ra.decision.status}, sealed=${ra.sealed}`);

  // agent-b: concurrent edit off the SAME base → CLEAN (selvage advanced).
  await sh(clone, 'git', 'checkout', '-q', '-b', 'bench-b', base);
  fs.appendFileSync(
    path.join(clone, 'packages/warpline/src/lifeline.ts'),
    '\nexport function benchAgentB(): number { return 2; }\n',
  );
  await sh(clone, 'git', 'commit', '-q', '-am', 'bench: agent-b edit');
  const shaB = await sh(clone, 'git', 'rev-parse', 'HEAD');
  const rb = await timed('[warm] admit agent-b (CLEAN merge: materialize + captureMerge, anchored)', () =>
    admit(clone, { agentId: 'agent-b', ref: shaB }),
  );
  console.log(`  → ${rb.decision.status}, sealed=${rb.sealed}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

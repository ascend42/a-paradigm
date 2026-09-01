/**
 * recovery-banner.test — the cross-branch checkpoint annotation.
 *
 * session-tracker.ts::saveCheckpoint() captures the git branch at save time
 * (detectGitBranch); context.ts::buildRecoveryPreamble() annotates the recovery
 * banner with "(from branch A — you are now on B)" when the recovering branch
 * differs. Contract:
 *   - cross-branch  → annotation present, naming both branches
 *   - same-branch   → no annotation
 *   - detached HEAD → no annotation, no crash (current branch unresolvable)
 *   - non-git dir   → no annotation, no crash (neither branch resolvable)
 *
 * HOME is sandboxed per test so the global store (~/.paradigm/sessions) is
 * hermetic and the real project checkpoint is never touched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { getSessionTracker, resetSessionTracker, SessionTracker } from '../utils/session-tracker.js';
import { buildRecoveryPreamble } from './context.js';

let tmp: string;
let envBak: Record<string, string | undefined>;
let cwdBak: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-banner-'));
  cwdBak = process.cwd();
  envBak = {
    HOME: process.env.HOME,
    PARADIGM_PROJECT_DIR: process.env.PARADIGM_PROJECT_DIR,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  };
  process.env.HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete process.env.PARADIGM_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  resetSessionTracker();
});

afterEach(() => {
  try { process.chdir(cwdBak); } catch { /* ignore */ }
  for (const [k, v] of Object.entries(envBak)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  resetSessionTracker();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(dir: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t',
      GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t',
    },
  }).trim();
}

/** Init a git repo that is also a Paradigm project, on branch `branch`. */
function makeRepo(branch: string): string {
  const dir = path.join(tmp, `repo-${branch}`);
  fs.mkdirSync(path.join(dir, '.paradigm'), { recursive: true });
  git(dir, 'init -q');
  git(dir, `checkout -q -b ${branch}`);
  fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
  git(dir, 'add -A');
  git(dir, 'commit -q -m init');
  return dir;
}

/** Save a checkpoint from the given repo (captures its current branch). */
function saveCheckpointIn(dir: string, context: string): void {
  const tracker = new SessionTracker();
  tracker.setRootDir(dir);
  tracker.saveCheckpoint({ phase: 'implementing', context });
}

describe('recovery banner — cross-branch annotation', () => {
  it('annotates when recovering on a DIFFERENT branch than the checkpoint', async () => {
    const repo = makeRepo('feat-a');
    saveCheckpointIn(repo, 'wiring the widget');
    // Move to a different branch.
    git(repo, 'checkout -q -b feat-b');

    const preamble = await buildRecoveryPreamble(repo);
    expect(preamble).toBeTruthy();
    expect(preamble!).toContain('(from branch feat-a — you are now on feat-b)');
  });

  it('does NOT annotate when recovering on the SAME branch', async () => {
    const repo = makeRepo('feat-a');
    saveCheckpointIn(repo, 'same branch work');

    const preamble = await buildRecoveryPreamble(repo);
    expect(preamble).toBeTruthy();
    expect(preamble!).toContain('same branch work');
    expect(preamble!).not.toContain('from branch');
  });

  it('detached HEAD → no annotation, no crash', async () => {
    const repo = makeRepo('feat-a');
    saveCheckpointIn(repo, 'detached case');
    // Detach HEAD onto the current commit sha.
    const sha = git(repo, 'rev-parse HEAD');
    git(repo, `checkout -q ${sha}`);

    const preamble = await buildRecoveryPreamble(repo);
    expect(preamble).toBeTruthy();
    expect(preamble!).toContain('detached case');
    expect(preamble!).not.toContain('from branch');
  });

  it('non-git project dir → no annotation, no crash', async () => {
    // Not a git repo — write a checkpoint file directly with a branch recorded,
    // so only the RECOVERY-side branch is unresolvable.
    const dir = path.join(tmp, 'nogit');
    fs.mkdirSync(path.join(dir, '.paradigm'), { recursive: true });
    const cp = {
      phase: 'implementing', context: 'nogit case',
      timestamp: Date.now(), sessionId: 'sX',
      branch: 'feat-a', recentBreadcrumbs: [],
    };
    fs.writeFileSync(path.join(dir, '.paradigm', 'session-checkpoint.json'), JSON.stringify(cp));

    const preamble = await buildRecoveryPreamble(dir);
    expect(preamble).toBeTruthy();
    expect(preamble!).toContain('nogit case');
    expect(preamble!).not.toContain('from branch');
  });
});

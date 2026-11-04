/**
 * logOrchestration records the repo state (baseCommit + dirty) so a logged
 * task can be replayed against the commit it ran on; outside a git repo the
 * fields are omitted and nothing throws. Status never takes index.lock (I1),
 * ignores Paradigm's own .paradigm/ state, and a status failure keeps
 * baseCommit (I2).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { execFileSync } from 'child_process';

// Spy on the git invocations readRepoState makes (real git still runs).
const spy = vi.hoisted(() => ({ calls: [] as Array<{ args: string[]; env?: NodeJS.ProcessEnv }>, failStatus: false }));
vi.mock('child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('child_process')>();
  const wrapped = ((file: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
    if (file === 'git') {
      spy.calls.push({ args, env: opts?.env });
      if (spy.failStatus && args.includes('status')) throw Object.assign(new Error('timed out'), { name: 'ETIMEDOUT' });
    }
    return (actual.execFileSync as (...a: unknown[]) => unknown)(file, args, opts);
  }) as typeof actual.execFileSync;
  return { ...actual, execFileSync: wrapped };
});

import { logOrchestration, readRepoState } from './orchestration.js';

let root: string;

/**
 * The test's own git, with every inherited GIT_* variable stripped (N4): run
 * from a git hook (GIT_DIR, GIT_INDEX_FILE, ...) it would otherwise act on the
 * outer repository instead of the temp one.
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v;
  return env;
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: cleanGitEnv() });
}

function commitAll(): void {
  git(['add', '.']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
}

// readRepoState inherits process.env, so strip GIT_* there too for the test run.
const savedGitEnv: Record<string, string | undefined> = {};

const plan = {
  task: 't', mode: 'faceted' as const, symbols: ['#x'], estimatedAgents: 1,
  estimatedTokens: { min: 1, max: 2 },
  stages: [{ stage: 0, canRunParallel: false, agents: [{ name: 'builder', task: 't', dependsOn: [], required: true }] }],
};

function readLog(id: string): Record<string, unknown> {
  return yaml.load(fs.readFileSync(path.join(root, '.paradigm', 'orchestrations', `${id}.yaml`), 'utf8')) as Record<string, unknown>;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orch-repo-state-')));
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('GIT_')) { savedGitEnv[k] = process.env[k]; delete process.env[k]; }
  }
  spy.calls.length = 0;
  spy.failStatus = false;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedGitEnv)) {
    if (v !== undefined) process.env[k] = v;
    delete savedGitEnv[k];
  }
});

describe('logOrchestration repo state', () => {
  it('records baseCommit and dirty=false on a clean repo', () => {
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    // .paradigm/orchestrations is written by the log itself; keep it out of status.
    fs.writeFileSync(path.join(root, '.gitignore'), '.paradigm/\n');
    git(['add', '.']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
    const head = git(['rev-parse', 'HEAD']).trim();

    logOrchestration(root, 'orch-clean', 'task', plan as never);
    const logged = readLog('orch-clean');
    expect(logged.baseCommit).toBe(head);
    expect(logged.dirty).toBe(false);
    expect(logged.task).toBe('task');
  });

  it('records dirty=true when the tree has uncommitted changes', () => {
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    git(['add', '.']);
    git(['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'changed');

    expect(readRepoState(root)).toEqual({ baseCommit: git(['rev-parse', 'HEAD']).trim(), dirty: true });
  });

  it('omits the fields outside a git repo (and on an unborn HEAD) without throwing', () => {
    logOrchestration(root, 'orch-nogit', 'task', plan as never);
    const logged = readLog('orch-nogit');
    expect('baseCommit' in logged).toBe(false);
    expect('dirty' in logged).toBe(false);

    git(['init', '-q']);
    expect(readRepoState(root)).toEqual({});
  });

  it('I1: status never takes index.lock (--no-optional-locks and GIT_OPTIONAL_LOCKS=0)', () => {
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    commitAll();
    spy.calls.length = 0;
    readRepoState(root);
    const status = spy.calls.find(c => c.args.includes('status'));
    expect(status?.args).toContain('--no-optional-locks');
    expect(status?.env?.GIT_OPTIONAL_LOCKS).toBe('0');
  });

  it('I2: changes only under .paradigm/ are Paradigm state, not dirty', () => {
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    commitAll();
    fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'events', 'stream.jsonl'), '{}\n');
    expect(readRepoState(root).dirty).toBe(false);
    // The orchestration log itself (written under .paradigm/) does not dirty the tree either.
    logOrchestration(root, 'orch-own-state', 'task', plan as never);
    expect(readLog('orch-own-state').dirty).toBe(false);
  });

  it('I2: a status failure keeps baseCommit and omits only dirty', () => {
    git(['init', '-q']);
    fs.writeFileSync(path.join(root, 'a.txt'), 'a');
    commitAll();
    spy.failStatus = true;
    expect(readRepoState(root)).toEqual({ baseCommit: git(['rev-parse', 'HEAD']).trim() });
  });
});

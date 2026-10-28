/**
 * Scoped learning S2 (TD-2026-10-28-820): repo identity (worktrees share their
 * main checkout's id, a template/fork pair does not), the machine home in the
 * OS state dir (macOS, Linux, Windows), the hashed author identity, and the
 * no-HOME fallback.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  currentAuthor,
  isOwnAuthor,
  machineStateDir,
  pathFor,
  resetLearningStoreCaches,
  safeHomeDir,
} from './learning-stores.js';
import { mainCheckoutPathOf, repoIdOf, repoIdSegment } from './repo-id.js';

const dirs: string[] = [];
const tmp = (prefix: string): string => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
};
const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const hasGit = spawnSync('git', ['--version']).status === 0;

beforeEach(() => resetLearningStoreCaches());
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  resetLearningStoreCaches();
});

describe.skipIf(!hasGit)('repoIdOf (S2): main checkout, never the root commit', () => {
  it('a linked worktree shares its main checkout id; the path is the main checkout', () => {
    const main = tmp('s2-main-');
    git(main, 'init', '-q');
    fs.writeFileSync(path.join(main, 'a.txt'), 'a\n');
    git(main, 'add', 'a.txt');
    git(main, 'commit', '-qm', 'init');
    const wt = path.join(tmp('s2-wt-parent-'), 'wt');
    git(main, 'worktree', 'add', '-q', wt);
    expect(mainCheckoutPathOf(wt)).toBe(main);
    expect(repoIdOf(wt)).toBe(repoIdOf(main));
    expect(repoIdSegment(wt)).toBe(repoIdSegment(main));
    // plain checkout: same as gnomon's hash of realpath(root)
    expect(repoIdOf(main)).toBe(`path:${createHash('sha256').update(main).digest('hex').slice(0, 16)}`);
    // a subfolder project keeps its own id, shared with its worktree twin
    fs.mkdirSync(path.join(main, 'packages', 'app'), { recursive: true });
    fs.mkdirSync(path.join(wt, 'packages', 'app'), { recursive: true });
    expect(repoIdOf(path.join(wt, 'packages', 'app'))).toBe(repoIdOf(path.join(main, 'packages', 'app')));
    expect(repoIdOf(path.join(main, 'packages', 'app'))).not.toBe(repoIdOf(main));
    // the machine and user homes follow
    expect(pathFor('team-funnel', 'machine', wt)).toBe(pathFor('team-funnel', 'machine', main));
    expect(pathFor('verdicts', 'user', wt)).toBe(pathFor('verdicts', 'user', main));
  });

  it('a template/fork pair (same root commit) gets two ids', () => {
    const tpl = tmp('s2-tpl-');
    git(tpl, 'init', '-q');
    fs.writeFileSync(path.join(tpl, 'a.txt'), 'a\n');
    git(tpl, 'add', 'a.txt');
    git(tpl, 'commit', '-qm', 'root');
    const fork = path.join(tmp('s2-fork-parent-'), 'fork');
    git(path.dirname(fork), 'clone', '-q', tpl, fork);
    expect(git(fork, 'rev-list', '--max-parents=0', 'HEAD')).toBe(git(tpl, 'rev-list', '--max-parents=0', 'HEAD'));
    expect(repoIdOf(fork)).not.toBe(repoIdOf(tpl));
    expect(repoIdSegment(fork)).toMatch(/^h-[0-9a-f]{16}$/);
  });

  it('a gnomon repoId in the main checkout names its worktrees too', () => {
    const main = tmp('s2-gmain-');
    git(main, 'init', '-q');
    git(main, 'commit', '-q', '--allow-empty', '-m', 'init');
    const wt = path.join(tmp('s2-gwt-parent-'), 'wt');
    git(main, 'worktree', 'add', '-q', wt);
    fs.mkdirSync(path.join(main, '.gnomon'));
    fs.writeFileSync(path.join(main, '.gnomon', 'project.yaml'), 'repoId: acme-widgets\n');
    expect(repoIdSegment(wt)).toBe('g-acme-widgets');
  });
});

describe('machine home: the OS state directory (S2)', () => {
  it('macOS, Linux (XDG and fallback) and Windows (%LOCALAPPDATA% and fallback)', () => {
    expect(machineStateDir({ platform: 'darwin', homeDir: '/Users/me', env: {} }))
      .toBe('/Users/me/Library/Application Support/paradigm/state');
    expect(machineStateDir({ platform: 'linux', homeDir: '/home/me', env: { XDG_STATE_HOME: '/xdg/state' } }))
      .toBe('/xdg/state/paradigm');
    expect(machineStateDir({ platform: 'linux', homeDir: '/home/me', env: {} }))
      .toBe('/home/me/.local/state/paradigm');
    // a relative XDG_STATE_HOME is ignored (XDG spec)
    expect(machineStateDir({ platform: 'linux', homeDir: '/home/me', env: { XDG_STATE_HOME: 'rel' } }))
      .toBe('/home/me/.local/state/paradigm');
    expect(machineStateDir({ platform: 'win32', homeDir: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } }))
      .toBe('C:\\Users\\me\\AppData\\Local\\paradigm\\state');
    expect(machineStateDir({ platform: 'win32', homeDir: 'C:\\Users\\me', env: {} }))
      .toBe('C:\\Users\\me\\AppData\\Local\\paradigm\\state');
  });

  it('without PARADIGM_LEARNING_HOME, machine rows go to <state dir>/<repoId>, outside the repo', () => {
    const root = tmp('s2-root-');
    const home = tmp('s2-home-');
    const prev = process.env.PARADIGM_LEARNING_HOME;
    delete process.env.PARADIGM_LEARNING_HOME;
    try {
      const p = pathFor('hook-timings', 'machine', root, { homeDir: home });
      expect(p).toBe(path.join(machineStateDir({ homeDir: home }), repoIdSegment(root), 'events', 'hook-timings.jsonl'));
      expect(p.startsWith(root)).toBe(false);
    } finally {
      if (prev !== undefined) process.env.PARADIGM_LEARNING_HOME = prev;
    }
  });

  it('safeHomeDir never returns empty: with HOME unset it falls back to the passwd entry', () => {
    const prev = process.env.HOME;
    delete process.env.HOME;
    try {
      const h = safeHomeDir();
      expect(path.isAbsolute(h)).toBe(true);
    } finally {
      if (prev !== undefined) process.env.HOME = prev;
    }
  });
});

describe('author identity (S2)', () => {
  let prevAuthor: string | undefined;
  beforeEach(() => {
    prevAuthor = process.env.PARADIGM_AUTHOR;
    delete process.env.PARADIGM_AUTHOR;
  });
  afterEach(() => {
    if (prevAuthor === undefined) delete process.env.PARADIGM_AUTHOR;
    else process.env.PARADIGM_AUTHOR = prevAuthor;
  });

  it('$PARADIGM_AUTHOR wins', () => {
    process.env.PARADIGM_AUTHOR = 'ci-bot';
    expect(currentAuthor()).toBe('ci-bot');
  });

  it.skipIf(!hasGit)('ue: + 12 hex of sha256(lowercased git email), stable, never the raw email', () => {
    const root = tmp('s2-author-');
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'Jane.Doe@Example.COM');
    const a = currentAuthor(root);
    resetLearningStoreCaches();
    const b = currentAuthor(root);
    expect(a).toBe(b);
    expect(a).toBe(`ue:${createHash('sha256').update('jane.doe@example.com').digest('hex').slice(0, 12)}`);
    expect(a).not.toContain('@');
    expect(a.toLowerCase()).not.toContain('jane');
    expect(isOwnAuthor(a, root)).toBe(true);
    expect(isOwnAuthor('ue:000000000000', root)).toBe(false);
  });

  it('without a git email: uh: + a hash of the OS username, never the raw name', () => {
    const root = tmp('s2-noemail-');
    const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
    const prevSystem = process.env.GIT_CONFIG_NOSYSTEM;
    process.env.GIT_CONFIG_GLOBAL = path.join(root, 'none');
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    try {
      const a = currentAuthor(root);
      const user = os.userInfo().username;
      expect(a).toBe(`uh:${createHash('sha256').update(user).digest('hex').slice(0, 12)}`);
      expect(a).not.toContain(user);
      // an S1 row stamped with the raw username still reads as mine
      expect(isOwnAuthor(user, root)).toBe(true);
    } finally {
      if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
      if (prevSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
      else process.env.GIT_CONFIG_NOSYSTEM = prevSystem;
    }
  });
});

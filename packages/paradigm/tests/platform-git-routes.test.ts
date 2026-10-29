/**
 * platform-git-routes.test — every platform-server simple-git call site run
 * against a REAL temp git repository (pinned for the simple-git 3 → 4 upgrade:
 * v4 dropped the default export and blocks abbreviated git options).
 *
 * Covered:
 *   routes/git.ts       status, branches, log (maxCount + --skip offset), diff
 *                       (worktree + --cached + pathspec), stage, unstage,
 *                       commit, push (to a temp bare remote)
 *   routes/overview.ts  current branch + recent commits in the activity feed
 *   routes/warpline.ts  GET /refs (branch list + HEAD)
 *
 * FIXTURES ONLY — git runs with cwd in mkdtemp dirs; the user's global and
 * system git config are masked so hooks, signing and templates never apply.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as http from 'node:http';
import { execFileSync } from 'node:child_process';
import express from 'express';
import { createGitRouter } from '../src/platform-server/routes/git.js';
import { createOverviewHandler } from '../src/platform-server/routes/overview.js';
import { createWarplineRouter } from '../src/platform-server/routes/warpline.js';

const ENV_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT'] as const;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('platform-server simple-git call sites (real temp repo)', () => {
  let tmp: string;
  let repo: string;
  let remote: string;
  let server: http.Server;
  let base: string;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  const get = async (p: string): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${p}`);
    return { status: res.status, body: await res.json() };
  };
  const post = async (p: string, payload: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: await res.json() };
  };

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plat-git-'));
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const emptyGlobal = path.join(tmp, 'gitconfig-global');
    fs.writeFileSync(emptyGlobal, '', 'utf8');
    process.env.GIT_CONFIG_GLOBAL = emptyGlobal;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.GIT_TERMINAL_PROMPT = '0';

    remote = path.join(tmp, 'remote.git');
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git(tmp, 'init', '--bare', '--initial-branch=main', remote);
    git(repo, 'init', '--initial-branch=main');
    git(repo, 'config', 'user.name', 'Fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    git(repo, 'config', 'commit.gpgsign', 'false');

    // Three commits so log limit/offset is observable.
    for (let i = 1; i <= 3; i++) {
      write(repo, `file${i}.txt`, `v${i}\n`);
      git(repo, 'add', '.');
      git(repo, 'commit', '-m', `feat(#c${i}): commit ${i}`);
    }
    git(repo, 'branch', 'side');
    git(repo, 'remote', 'add', 'origin', remote);
    git(repo, 'push', '-u', 'origin', 'main');

    const app = express();
    app.use(express.json());
    app.use('/api/git', createGitRouter(repo));
    app.get('/api/overview', createOverviewHandler(repo));
    app.use('/api/warpline', createWarplineRouter(repo));
    // loopback only: the stage/commit/push routes must not be reachable from the LAN while tests run
    server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const addr = server.address();
    if (addr === null || typeof addr === 'string') throw new Error('no port');
    base = `http://127.0.0.1:${addr.port}/api`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // branch() runs `git branch -v -a` (same default in simple-git 3 and 4), so
  // the remote-tracking ref is listed alongside the local branches.
  it('GET /git/branches and /warpline/refs list branches with HEAD', async () => {
    const branches = await get('/git/branches');
    expect(branches.status).toBe(200);
    expect(branches.body.current).toBe('main');
    const names = branches.body.branches.map((b: { name: string }) => b.name).sort();
    expect(names).toEqual(['main', 'remotes/origin/main', 'side']);
    const mainBranch = branches.body.branches.find((b: { name: string }) => b.name === 'main');
    expect(mainBranch.current).toBe(true);
    expect(mainBranch.commit).toBe(git(repo, 'rev-parse', '--short', 'HEAD'));

    const refs = await get('/warpline/refs');
    expect(refs.status).toBe(200);
    expect(refs.body.head).toBe('main');
    expect([...refs.body.branches].sort()).toEqual(['main', 'remotes/origin/main', 'side']);
  });

  it('GET /git/log honours limit and the --skip offset', async () => {
    const all = await get('/git/log?limit=10');
    expect(all.status).toBe(200);
    expect(all.body.commits.map((c: { message: string }) => c.message)).toEqual([
      'feat(#c3): commit 3',
      'feat(#c2): commit 2',
      'feat(#c1): commit 1',
    ]);
    expect(all.body.commits[0].hash).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect(all.body.commits[0].shortHash).toHaveLength(7);
    expect(all.body.commits[0].author).toBe('Fixture');
    expect(all.body.commits[0].symbols).toEqual(['#c3']);

    const page = await get('/git/log?limit=1&offset=1');
    expect(page.status).toBe(200);
    expect(page.body.commits.map((c: { message: string }) => c.message)).toEqual(['feat(#c2): commit 2']);
    expect(page.body.total).toBe(1);
  });

  it('status / diff / stage / unstage reflect a real worktree change', async () => {
    write(repo, 'file1.txt', 'v1-edited\n');
    write(repo, 'new.txt', 'brand new\n');

    let status = await get('/git/status');
    expect(status.status).toBe(200);
    expect(status.body.branch).toBe('main');
    expect(status.body.ahead).toBe(0);
    expect(status.body.behind).toBe(0);
    expect(status.body.staged).toEqual([]);
    expect(status.body.unstaged).toEqual(['file1.txt']);
    expect(status.body.untracked).toEqual(['new.txt']);

    const diff = await get('/git/diff?path=file1.txt');
    expect(diff.status).toBe(200);
    expect(diff.body.diff).toContain('+v1-edited');
    expect((await get('/git/diff?path=file2.txt')).body.diff).toBe('');

    // an option-shaped path is refused before git sees it
    expect((await post('/git/stage', { paths: ['--chmod=+x'] })).status).toBe(400);
    expect((await post('/git/stage', { paths: [42] })).status).toBe(400);
    const staged = await post('/git/stage', { paths: ['file1.txt'] });
    expect(staged).toEqual({ status: 200, body: { staged: ['file1.txt'] } });
    status = await get('/git/status');
    expect(status.body.staged).toEqual(['file1.txt']);
    expect(status.body.unstaged).toEqual([]);
    expect((await get('/git/diff?staged=true')).body.diff).toContain('+v1-edited');
    expect((await get('/git/diff')).body.diff).toBe('');

    const unstaged = await post('/git/unstage', { paths: ['file1.txt'] });
    expect(unstaged).toEqual({ status: 200, body: { unstaged: ['file1.txt'] } });
    status = await get('/git/status');
    expect(status.body.staged).toEqual([]);
    expect(status.body.unstaged).toEqual(['file1.txt']);

    expect((await post('/git/stage', { paths: [] })).status).toBe(400);
    expect((await post('/git/unstage', {})).status).toBe(400);
  });

  it('POST /git/commit then /git/push lands the commit on the remote', async () => {
    await post('/git/stage', { paths: ['file1.txt', 'new.txt'] });
    expect((await post('/git/commit', { message: '  ' })).status).toBe(400);

    const commit = await post('/git/commit', { message: 'fix(#c1): edit file1' });
    expect(commit.status).toBe(200);
    expect(git(repo, 'log', '-1', '--format=%s')).toBe('fix(#c1): edit file1');
    expect((await get('/git/status')).body.ahead).toBe(1);

    const push = await post('/git/push', {});
    expect(push.status).toBe(200);
    expect(push.body.pushed).toBe(true);
    expect(git(remote, 'rev-parse', 'main')).toBe(git(repo, 'rev-parse', 'HEAD'));
    expect((await get('/git/status')).body.ahead).toBe(0);
  });

  it('GET /overview reports the branch and git commits in recent activity', async () => {
    const overview = await get('/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.project.branch).toBe('main');
    const commits = overview.body.recentActivity.filter((a: { type: string }) => a.type === 'commit');
    expect(commits.map((c: { summary: string }) => c.summary)).toContain('fix(#c1): edit file1');
    const head = commits.find((c: { summary: string }) => c.summary === 'fix(#c1): edit file1');
    expect(head.symbol).toBe('#c1');
    expect(head.link).toBe(git(repo, 'rev-parse', '--short=7', 'HEAD'));
  });
});

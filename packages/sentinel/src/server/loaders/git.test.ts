/**
 * git loader test — loadGitHistory / getSymbolsAtCommit against a REAL temp
 * git repository (pinned for the simple-git 3 → 4 upgrade: v4 dropped the
 * default export and blocks abbreviated git options).
 *
 * FIXTURES ONLY — git runs with cwd in mkdtemp dirs; the user's global and
 * system git config are masked so hooks, signing and templates never apply.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadGitHistory, getSymbolsAtCommit } from './git.js';

const ENV_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'] as const;

function git(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('sentinel git loader (real temp repo)', () => {
  let tmp: string;
  let repo: string;
  let notRepo: string;
  let firstHash: string;
  let secondHash: string;
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-git-'));
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const emptyGlobal = path.join(tmp, 'gitconfig-global');
    fs.writeFileSync(emptyGlobal, '', 'utf8');
    process.env.GIT_CONFIG_GLOBAL = emptyGlobal;
    process.env.GIT_CONFIG_NOSYSTEM = '1';

    notRepo = path.join(tmp, 'plain');
    fs.mkdirSync(notRepo);
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git(repo, {}, 'init', '--initial-branch=main');
    git(repo, {}, 'config', 'user.name', 'Fixture');
    git(repo, {}, 'config', 'user.email', 'fixture@example.invalid');
    git(repo, {}, 'config', 'commit.gpgsign', 'false');

    const old = { GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' };
    write(repo, 'README.md', 'hi\n');
    git(repo, old, 'add', '.');
    git(repo, old, 'commit', '-m', 'initial');
    firstHash = git(repo, {}, 'rev-parse', 'HEAD');

    write(repo, 'src/components/cart/.purpose', 'components: {}\n');
    write(repo, 'src/components/cart/index.ts', 'export {};\n');
    write(repo, 'portal.yaml', 'gates: {}\n');
    git(repo, {}, 'add', '.');
    git(repo, {}, 'commit', '-m', 'feat(#cart): add cart\n\nbody line');
    secondHash = git(repo, {}, 'rev-parse', 'HEAD');
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns [] outside a git repository', async () => {
    expect(await loadGitHistory(notRepo)).toEqual([]);
  });

  it('loads commits newest-first with changed files and inferred symbols', async () => {
    const commits = await loadGitHistory(repo);
    expect(commits.map((c) => c.hash)).toEqual([secondHash, firstHash]);

    const [head, root] = commits;
    expect(head.shortHash).toBe(secondHash.slice(0, 7));
    expect(head.author).toBe('Fixture');
    expect(head.message).toBe('feat(#cart): add cart');
    expect([...head.filesChanged].sort()).toEqual([
      'portal.yaml',
      'src/components/cart/.purpose',
      'src/components/cart/index.ts',
    ]);
    expect([...head.symbolsModified].sort()).toEqual(['#cart', '^portal']);

    // Root commit has no parent: the diff is skipped, not fatal.
    expect(root.filesChanged).toEqual([]);
    expect(root.symbolsModified).toEqual([]);
  });

  it('honours limit and --since', async () => {
    expect((await loadGitHistory(repo, { limit: 1 })).map((c) => c.hash)).toEqual([secondHash]);
    expect((await loadGitHistory(repo, { since: '2021-01-01' })).map((c) => c.hash)).toEqual([secondHash]);
  });

  it('getSymbolsAtCommit reads .purpose files from the tree at a commit', async () => {
    expect(await getSymbolsAtCommit(repo, secondHash)).toEqual(['#cart']);
    expect(await getSymbolsAtCommit(repo, firstHash)).toEqual([]);
  });
});

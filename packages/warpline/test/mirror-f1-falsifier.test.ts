/**
 * mirror-f1-falsifier.test — Arky's F1 falsifier, Warpline variant
 * (T-2026-11-06-001): "a commit leaves the tree clean".
 *
 * Before 0.3.0 a repo following Warpline's own layout TRACKED .warpline/
 * fabric.jsonl and both tip pointers (they were the anti-truncation backstop,
 * audit C-6), and the auto-seal hook appends to them in the background AFTER the
 * commit — so every commit left `git status --porcelain` dirty, and two branches
 * that both sealed conflicted on the ledger.
 *
 * The falsifier, end to end with the BUILT CLI and real git:
 *   1. a scratch repo in the 0.2.2 tracked layout, cloned from a bare remote;
 *   2. `warpline migrate` (seed + verify the mirror, untrack) and
 *      `warpline hook install`;
 *   3. 10 commits on each of two branches; after every commit, wait for the
 *      background seal to finish, then `git status --porcelain` must be EMPTY;
 *   4. checkout between the branches, and `git pull --rebase` from the bare
 *      remote that is 5 commits ahead, succeed with no conflict and a clean tree;
 *   5. the mirror recorded every seal and `warpline push` publishes it.
 * On 0.2.2 step 2 does not exist and step 3 fails on the first commit.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hookLogPath } from '../src/fabric/hook.js';
import { parseLedger } from '../src/fabric/git-mirror.js';
import { readWriterId } from '../src/fabric/writer.js';

const BRANCH = 'refs/heads/warpline/fabric';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_CLI = path.join(PKG_ROOT, 'dist', 'cli.js');

const OLD_GITIGNORE = [
  '.warpline/*',
  '!.warpline/fabric.jsonl',
  '!.warpline/fabric-legacy.json',
  '!.warpline/config.json',
  '!.warpline/refs/',
  '.warpline/refs/*',
  '!.warpline/refs/selvage',
  '!.warpline/refs/heads/',
  '.warpline/refs/heads/*',
  '!.warpline/refs/heads/selvage',
  '',
].join('\n');

const ENV: NodeJS.ProcessEnv = (() => {
  const e: NodeJS.ProcessEnv = { ...process.env, WARPLINE_BIN: '', WARPLINE_AGENT_ID: '', WARPLINE_ROOT: '', WARPLINE_FSYNC: 'none' };
  for (const k of Object.keys(e)) if (k.startsWith('GIT_')) delete e[k];
  return e;
})();

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function warpline(cwd: string, ...args: string[]): string {
  const r = spawnSync(process.execPath, [DIST_CLI, ...args], { cwd, encoding: 'utf8', env: ENV });
  if (r.status !== 0) throw new Error(`warpline ${args.join(' ')} exited ${r.status}: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function configure(dir: string): void {
  git(dir, 'config', 'user.email', 'f1@warpline.test');
  git(dir, 'config', 'user.name', 'Warpline F1');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'pull.rebase', 'true');
  git(dir, 'config', 'core.hooksPath', path.join(dir, '.git', 'hooks'));
}

/** The auto-seal block's per-seal result lines (the pre-push block logs `mirror-push rc=` instead). */
const exits = (log: string): string[] => (log.match(/^ {4}exit=\d+$/gm) ?? []).map((l) => l.trim());

/** The ledger bytes recorded at `rev` (segments joined). */
function recordedBytes(dir: string, rev: string): Buffer {
  const segs = git(dir, 'ls-tree', '--name-only', `${rev}:ledger`).split('\n').filter(Boolean);
  return Buffer.concat(segs.map((s) => execFileSync('git', ['cat-file', 'blob', `${rev}:ledger/${s}`], { cwd: dir, env: ENV })));
}

async function until(pred: () => boolean, what: string, ms = 60_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitForSeals(logPath: string, count: number, ms = 60_000): Promise<string> {
  const deadline = Date.now() + ms;
  for (;;) {
    const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    if (exits(log).length >= count) return log;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${count} background seal(s); hook log:\n${log}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('F1 (Warpline W2): after every commit the tree is clean; checkout and pull --rebase never conflict', () => {
  let base: string;
  let remote: string;
  let work: string;

  beforeAll(() => {
    if (!fs.existsSync(DIST_CLI)) execFileSync('npm', ['run', 'build'], { cwd: PKG_ROOT, stdio: 'pipe' });
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-f1-')));
    remote = path.join(base, 'remote.git');
    work = path.join(base, 'work');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote], { env: ENV });
    execFileSync('git', ['init', '-q', '-b', 'main', work], { env: ENV });
    configure(work);
    git(work, 'remote', 'add', 'origin', remote);
  }, 180_000);

  afterAll(() => {
    if (base) fs.rmSync(base, { recursive: true, force: true });
  });

  it('runs the falsifier', async () => {
    // 1. The 0.2.2 layout: a sealed fabric TRACKED on the branch.
    fs.writeFileSync(path.join(work, '.gitignore'), OLD_GITIGNORE, 'utf8');
    fs.writeFileSync(path.join(work, '.purpose'), 'version: "2.0"\ndescription: F1\ncomponents:\n  c0:\n    description: C0\n    type: module\n');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'init');
    warpline(work, 'pick', '--ref', 'HEAD', '--quiet');
    // 0.2.2 sealed without a record — drop the one this 0.3.0 seal made
    for (const r of git(work, 'for-each-ref', '--format=%(refname)', 'refs/warpline', BRANCH).split('\n').filter(Boolean)) git(work, 'update-ref', '-d', r);
    fs.rmSync(path.join(work, '.git', 'warpline'), { recursive: true, force: true });
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'track the fabric (0.2.2 layout)');
    expect(git(work, 'ls-files', '.warpline').split('\n').sort()).toEqual([
      '.warpline/fabric.jsonl',
      '.warpline/refs/heads/selvage',
      '.warpline/refs/selvage',
    ]);
    git(work, 'push', '-q', '-u', 'origin', 'main');

    // 2. Migrate (seed + push the record, then untrack), commit via the "PR", install the hooks.
    const migrated = JSON.parse(warpline(work, 'mirror', 'migrate', '--auto-push', '--json')) as { untracked: string[]; pushed: string; path: string };
    expect(migrated.path).toBe('seed');
    expect(migrated.pushed).toBe('pushed');
    expect(migrated.untracked.length).toBe(3);
    git(work, 'add', '.gitignore', '.warpline/config.json');
    git(work, 'commit', '-q', '-m', 'move the fabric record to warpline/fabric');
    expect(git(work, 'status', '--porcelain')).toBe('');
    warpline(work, 'hook', 'install'); // autoPush in the config ⇒ the pre-push block too
    expect(fs.readFileSync(path.join(work, '.git', 'hooks', 'pre-push'), 'utf8')).toContain('warpline mirror push');
    const logPath = hookLogPath(path.join(work, '.git', 'hooks', 'post-commit'));
    git(work, 'push', '-q', 'origin', 'main');
    const wid = readWriterId(path.join(work, '.git'))!;

    // 3. 10 commits on each of two branches; the tree is clean after every one.
    let commits = 0;
    const commitAndCheck = async (branch: string, i: number): Promise<void> => {
      fs.writeFileSync(path.join(work, `${branch}-${i}.txt`), `${branch} ${i}\n`);
      git(work, 'add', '-A');
      const r = spawnSync('git', ['commit', '-q', '-m', `${branch} ${i}\n\nSymbols: #c0`], { cwd: work, encoding: 'utf8', env: ENV });
      expect(r.status, r.stderr).toBe(0);
      commits++;
      const log = await waitForSeals(logPath, commits);
      expect(exits(log).every((e) => e === 'exit=0'), `a background seal failed:\n${log}`).toBe(true);
      expect(git(work, 'status', '--porcelain'), `dirty after ${branch} commit ${i}`).toBe('');
    };
    for (const branch of ['a', 'b']) {
      git(work, 'checkout', '-q', '-b', branch, 'main');
      for (let i = 0; i < 10; i++) await commitAndCheck(branch, i);
    }

    // Every seal was recorded first: own ref == canonical branch == the ledger, genesis + 20 seals.
    const own = `refs/warpline/writers/${wid}`;
    expect(git(work, 'rev-parse', own)).toBe(git(work, 'rev-parse', BRANCH));
    const rec = recordedBytes(work, BRANCH);
    expect(parseLedger(rec).lines.length).toBe(1 + commits);
    expect(rec.equals(fs.readFileSync(path.join(work, '.warpline', 'fabric.jsonl')))).toBe(true);

    // 4a. Checkout between the branches: no conflict, clean tree.
    for (const b of ['a', 'b', 'a', 'main', 'b']) {
      git(work, 'checkout', '-q', b);
      expect(git(work, 'status', '--porcelain')).toBe('');
    }

    // 4b. A branch push hands the record to a DETACHED push (canonical writer only).
    const local = git(work, 'rev-parse', BRANCH);
    expect(git(remote, 'rev-parse', BRANCH)).not.toBe(local);
    git(work, 'push', '-q', 'origin', 'a', 'b'); // b too: a fork re-absorbs the tip state from its provenance commit
    await until(() => git(remote, 'rev-parse', BRANCH) === local, 'the detached record push');

    // The bare remote gets 5 commits ahead on `a` (from another clone, no hook) —
    // that clone also SEALS (adopts, forks) and pushes: the remote record must not move.
    const other = path.join(base, 'other');
    execFileSync('git', ['clone', '-q', '-b', 'a', remote, other], { env: ENV });
    configure(other);
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(other, `remote-${i}.txt`), `${i}\n`);
      git(other, 'add', '-A');
      git(other, 'commit', '-q', '-m', `remote ${i}`);
    }
    warpline(other, 'pick', '--ref', 'HEAD');
    const forkPush = spawnSync(process.execPath, [DIST_CLI, 'mirror', 'push', '--json'], { cwd: other, encoding: 'utf8', env: ENV });
    expect(forkPush.status).toBe(1); // a fork's push does nothing, and says so
    expect(JSON.parse(forkPush.stdout).action).not.toBe('pushed');
    git(other, 'push', '-q', 'origin', 'a');
    expect(git(remote, 'rev-parse', BRANCH)).toBe(local);

    // …and `work` has one unpushed local commit on `a`, so the pull really rebases.
    git(work, 'checkout', '-q', 'a');
    await commitAndCheck('a', 10);
    const pull = spawnSync('git', ['pull', '--rebase', 'origin', 'a'], { cwd: work, encoding: 'utf8', env: ENV });
    expect(pull.status, `${pull.stdout}${pull.stderr}`).toBe(0);
    expect(`${pull.stdout}${pull.stderr}`).not.toMatch(/CONFLICT/);
    await new Promise((r) => setTimeout(r, 500));
    await waitForSeals(logPath, exits(fs.readFileSync(logPath, 'utf8')).length);
    expect(git(work, 'status', '--porcelain')).toBe('');
    expect(git(work, 'rev-list', '--count', 'origin/a..a')).toBe('1');

    // 5. The record replicates; every commit on the remote record is the canonical writer's.
    expect(['pushed', 'up-to-date']).toContain(JSON.parse(warpline(work, 'mirror', 'push', '--json')).action);
    expect(git(remote, 'rev-parse', BRANCH)).toBe(git(work, 'rev-parse', BRANCH));
    for (const c of git(remote, 'rev-list', BRANCH).split('\n')) expect(git(remote, 'cat-file', 'blob', `${c}:writer`)).toBe(wid);
    const status = JSON.parse(warpline(work, 'mirror', 'status', '--json')) as { matches: boolean; missing: string[]; role: string };
    expect(status.matches).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.role).toBe('canonical');
  }, 300_000);
});

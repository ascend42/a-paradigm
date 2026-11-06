/**
 * Falsifiers F1-F8 for history derived from git (T-2026-11-06-001).
 *
 * Real git in scratch repositories with the hooks `paradigm hooks install`
 * writes. Git runs with an empty global config (no signing, templates or
 * core.hooksPath from the developer's machine) and a PATH holding only the
 * system tools and node, so the hooks resolve no paradigm CLI: what they would
 * write themselves is what is measured. On Windows git runs the hooks through
 * its own Git Bash (the shebang), so these run on the Windows CI unchanged.
 * F1's Warpline variant lives with the Warpline change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { SHELL_TEST_TIMEOUT, SYS_PATH, baseEnv, nodeOnlyDir, pathValue } from '../../test-shell-utils.js';
import { ensureHistoryGitattributes, ensureSessionMarkersGitignore } from '../../core/session-markers-gitignore.js';
import {
  checkFragility,
  isHistoryContextFresh,
  loadHistoryContext,
  loadMergedHistory,
} from '../../../../paradigm-mcp/src/utils/history-loader.js';

const T = SHELL_TEST_TIMEOUT * 2;

let base: string;
let env: NodeJS.ProcessEnv;
let cleanups: Array<() => void> = [];
const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-hfg-')));
  const cfg = path.join(base, 'gitconfig');
  fs.writeFileSync(cfg, '');
  const home = path.join(base, 'home');
  fs.mkdirSync(home);
  cleanups = [];
  env = {
    ...process.env,
    ...baseEnv(),
    PATH: pathValue([nodeOnlyDir(cleanups), ...SYS_PATH]),
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_GLOBAL: cfg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
  };
  // The CLI under test (hooks install, sync) must not see the real ~/.claude.
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(realHome)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  cleanups.forEach((fn) => fn());
  fs.rmSync(base, { recursive: true, force: true });
});

const gitIn = (cwd: string) => (args: string[], input?: string): string =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });

const porcelain = (cwd: string): string => gitIn(cwd)(['status', '--porcelain', '--untracked-files=all']);

function write(root: string, files: Record<string, string>): void {
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), c);
  }
}

function commitIn(root: string, msg: string, files: Record<string, string>): string {
  const git = gitIn(root);
  write(root, files);
  git(['add', '-A']);
  git(['commit', '-q', '-F', '-'], msg);
  return git(['rev-parse', 'HEAD']).trim();
}

/** A Paradigm project the way `paradigm init` leaves it, committed. */
function initProject(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  gitIn(dir)(['init', '-q', '-b', 'main']);
  write(dir, {
    '.paradigm/config.yaml': 'version: "1.0"\nproject: t\n',
    '.paradigm/history/log.jsonl': '',
  });
  ensureSessionMarkersGitignore(path.join(dir, '.paradigm'));
  ensureHistoryGitattributes(dir);
  commitIn(dir, 'chore: init', { 'README.md': 'x\n' });
  return dir;
}

async function hooksInstall(root: string, opts: { postCommit?: boolean; prePush?: boolean } = { postCommit: true, prePush: true }): Promise<void> {
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
  try {
    const { hooksInstallCommand } = await import('../hooks/index.js');
    await hooksInstallCommand(opts);
  } finally {
    cwd.mockRestore();
  }
}

/** Read history the way the MCP server and CLI do; this must not dirty the tree either. */
async function readHistory(root: string) {
  return loadHistoryContext(root);
}

describe('history derived from git: falsifiers', () => {
  it('F1: 10 commits on each of two branches and a pull --rebase leave the tree clean, ids distinct', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    await hooksInstall(root);
    const git = gitIn(root);
    // the bare remote, 5 commits ahead on a
    const remote = path.join(base, 'remote.git');
    execFileSync('git', ['init', '-q', '--bare', remote], { env });
    git(['remote', 'add', 'origin', remote]);

    git(['checkout', '-q', '-b', 'a']);
    for (let i = 0; i < 5; i++) {
      commitIn(root, `feat(#a${i}): a ${i}\n\nSymbols: #a${i}, #shared\n`, { [`src/a/${i}.ts`]: `${i}\n` });
      expect(porcelain(root), `after a${i}`).toBe('');
      await readHistory(root);
      expect(porcelain(root), `after reading history at a${i}`).toBe('');
    }
    git(['push', '-q', 'origin', 'a']);

    const other = path.join(base, 'other');
    execFileSync('git', ['clone', '-q', '-b', 'a', remote, other], { env });
    await hooksInstall(other);
    for (let i = 0; i < 5; i++) {
      commitIn(other, `feat(#r${i}): remote ${i}\n\nSymbols: #r${i}, #shared\n`, { [`src/r/${i}.ts`]: `${i}\n` });
      expect(porcelain(other), `remote r${i}`).toBe('');
    }
    gitIn(other)(['push', '-q', 'origin', 'a']);

    for (let i = 5; i < 10; i++) {
      commitIn(root, `feat(#a${i}): a ${i}\n\nSymbols: #a${i}, #shared\n`, { [`src/a/${i}.ts`]: `${i}\n` });
      expect(porcelain(root), `after a${i}`).toBe('');
    }
    git(['checkout', '-q', '-b', 'b', 'main']);
    for (let i = 0; i < 10; i++) {
      commitIn(root, `fix(#b${i}): b ${i}\n\nSymbols: #b${i}, #shared\n`, { [`src/b/${i}.ts`]: `${i}\n` });
      expect(porcelain(root), `after b${i}`).toBe('');
      await readHistory(root);
      expect(porcelain(root), `after reading history at b${i}`).toBe('');
    }

    git(['checkout', '-q', 'b']);
    git(['checkout', '-q', 'a']);
    expect(porcelain(root)).toBe('');
    // exit 0 and no conflict (execFileSync throws on a non-zero exit)
    git(['pull', '-q', '--rebase', 'origin', 'a']);
    expect(porcelain(root)).toBe('');
    expect(git(['rev-list', '--count', 'main..HEAD']).trim()).toBe('15');

    const { entries } = loadMergedHistory(root);
    const derived = entries.filter((e) => e.source === 'git' && e.symbols.includes('#shared'));
    expect(derived).toHaveLength(15); // a0-a9 rebased + r0-r4 (b is not reachable from a)
    expect(new Set(derived.map((e) => e.id)).size).toBe(15);
    expect(new Set(derived.map((e) => e.commit)).size).toBe(15);
    await readHistory(root);
    expect(porcelain(root)).toBe('');
  });

  it('F2: merge --squash of 3 commits with a GitHub-style body puts every symbol on main', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    await hooksInstall(root);
    const git = gitIn(root);
    git(['checkout', '-q', '-b', 'feature']);
    const featureShas = [
      commitIn(root, 'feat(#s1): one\n\nSymbols: #s1\n', { 'src/s/1.ts': '1' }),
      commitIn(root, 'fix(#s2): two\n\nSymbols: #s2, ^gate-s\n', { 'src/s/2.ts': '1' }),
      commitIn(root, 'refactor(#s3): three\n\nSymbols: #s3\n', { 'src/s/3.ts': '1' }),
    ];
    git(['checkout', '-q', 'main']);
    git(['merge', '-q', '--squash', 'feature']);
    const body = [
      'feat(#s1): squash of three (#12)',
      '',
      '* feat(#s1): one',
      '',
      'Symbols: #s1',
      '',
      '* fix(#s2): two',
      '',
      'Symbols: #s2, ^gate-s',
      '',
      '* refactor(#s3): three',
      '',
      'Symbols: #s3',
      '',
    ].join('\n');
    git(['commit', '-q', '-F', '-'], body);
    const squash = git(['rev-parse', 'HEAD']).trim();
    expect(porcelain(root)).toBe('');

    const { entries } = loadMergedHistory(root);
    const row = entries.find((e) => e.commit === squash);
    expect(row?.symbols).toEqual(['#s1', '#s2', '#s3', '^gate-s']);
    const reachable = new Set(git(['rev-list', 'HEAD']).split('\n').filter(Boolean));
    for (const e of entries.filter((x) => x.source === 'git')) expect(reachable.has(e.commit!)).toBe(true);
    for (const sha of featureShas) expect(entries.some((e) => e.commit === sha)).toBe(false);
    const ctx = await readHistory(root);
    for (const s of ['#s1', '#s2', '#s3', '^gate-s']) expect(ctx.index?.by_symbol[s]?.total_changes).toBe(1);
  });

  it('F3: amend leaves one row for the new SHA; cherry-pick adds a distinct row', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    await hooksInstall(root);
    const git = gitIn(root);
    const before = commitIn(root, 'feat(#x): first\n\nSymbols: #x\n', { 'src/x.ts': '1' });
    expect(loadMergedHistory(root).entries.some((e) => e.commit === before)).toBe(true);
    git(['commit', '-q', '--amend', '-F', '-'], 'feat(#x): first, amended\n\nSymbols: #x\n');
    const after = git(['rev-parse', 'HEAD']).trim();
    expect(porcelain(root)).toBe('');
    let rows = loadMergedHistory(root).entries.filter((e) => e.symbols.includes('#x'));
    expect(rows.map((e) => e.commit)).toEqual([after]);

    git(['checkout', '-q', '-b', 'other', 'HEAD~1']);
    commitIn(root, 'chore: diverge', { 'other.txt': '1' }); // a different parent, so a different SHA
    git(['cherry-pick', after]);
    const picked = git(['rev-parse', 'HEAD']).trim();
    expect(picked).not.toBe(after);
    expect(porcelain(root)).toBe('');
    rows = loadMergedHistory(root).entries.filter((e) => e.symbols.includes('#x'));
    expect(rows.map((e) => e.commit)).toEqual([picked]);
    expect(rows[0].id).toBe(`h-${picked.slice(0, 12)}`);
    git(['merge', '-q', '--no-edit', 'main']);
    rows = loadMergedHistory(root).entries.filter((e) => e.symbols.includes('#x'));
    expect(new Set(rows.map((e) => e.id)).size).toBe(2);
  });

  it('F4: history record on two branches merges by union with two distinct ids', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    await hooksInstall(root);
    const git = gitIn(root);
    const { historyRecordCommand } = await import('./index.js');
    const record = async (sym: string) => {
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
      try {
        await historyRecordCommand({ type: 'rollback', symbols: sym, description: `rollback ${sym}`, reason: 'r' });
      } finally {
        cwd.mockRestore();
      }
    };
    git(['checkout', '-q', '-b', 'one']);
    await record('#p');
    commitIn(root, 'chore: record on one', {});
    git(['checkout', '-q', '-b', 'two', 'main']);
    await record('#q');
    commitIn(root, 'chore: record on two', {});
    git(['checkout', '-q', 'one']);
    git(['merge', '-q', '--no-edit', 'two']); // throws on a conflict
    expect(porcelain(root)).toBe('');
    const rows = fs.readFileSync(path.join(root, '.paradigm', 'history', 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    for (const r of rows) {
      expect(r.id).toMatch(/^h-[0-9a-z]{12}$/);
      expect(r.source).toBe('authored');
    }
  });

  it('F5: a repo with a tracked index.yaml and v3 hooks migrates with sync + hooks install; a second run is a no-op', { timeout: T }, async () => {
    const root = path.join(base, 'repo');
    fs.mkdirSync(root);
    const git = gitIn(root);
    git(['init', '-q', '-b', 'main']);
    // the pre-migration layout: index.yaml tracked, no merge attribute, v3 hooks
    write(root, {
      '.paradigm/config.yaml': 'version: "1.0"\nproject: t\n',
      '.paradigm/history/log.jsonl': '{"id":"h0001","ts":"2026-01-01T00:00:00Z","type":"implement","symbols":["#old"],"author":{"type":"human","id":"ada"},"commit":"' + 'e'.repeat(40) + '"}\n',
      '.paradigm/history/index.yaml': 'version: "1.0"\nby_symbol: {}\n',
    });
    commitIn(root, 'chore: old layout', {});
    const hooksDir = path.join(root, '.git', 'hooks');
    const v3 = '#!/bin/sh\n# Paradigm post-commit hook - captures history from commits\n# Installed by: paradigm hooks install\n# paradigm-hook-version: 3\necho x >> .paradigm/history/log.jsonl\n';
    const v3push = '#!/bin/sh\n# Paradigm pre-push hook - reindex history before pushing\n# Installed by: paradigm hooks install\n# paradigm-hook-version: 3\n';
    fs.writeFileSync(path.join(hooksDir, 'post-commit'), v3, { mode: 0o755 });
    fs.writeFileSync(path.join(hooksDir, 'pre-push'), v3push, { mode: 0o755 });
    // the old hook dirties the tree on every commit
    commitIn(root, 'feat(#y): before migration\n\nSymbols: #y\n', { 'src/y.ts': '1' });
    expect(porcelain(root)).not.toBe('');
    git(['checkout', '--', '.paradigm/history/log.jsonl']);

    const { syncCommand } = await import('../sync.js');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write);
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write);
    try {
      await syncCommand('claude', { mcp: false, quiet: true });
    } finally {
      cwd.mockRestore();
    }
    await hooksInstall(root);

    expect(git(['ls-files', '--', '.paradigm/history/index.yaml']).trim()).toBe('');
    expect(fs.existsSync(path.join(root, '.paradigm', 'history', 'index.yaml'))).toBe(true); // kept on disk
    expect(git(['ls-files', '--', '.paradigm/history/log.jsonl']).trim()).toBe('.paradigm/history/log.jsonl');
    expect(git(['check-attr', 'merge', '--', '.paradigm/history/log.jsonl']).trim()).toBe('.paradigm/history/log.jsonl: merge: union');
    expect(git(['check-ignore', '--', '.paradigm/history/index.yaml']).trim()).toBe('.paradigm/history/index.yaml');
    const { gitHookState } = await import('../hooks/git-hook-state.js');
    expect(gitHookState(fs.readFileSync(path.join(hooksDir, 'post-commit'), 'utf8'), 'post-commit')).toBe('current');
    expect(gitHookState(fs.readFileSync(path.join(hooksDir, 'pre-push'), 'utf8'), 'pre-push')).toBe('current');
    expect(fs.readFileSync(path.join(root, '.git', 'paradigm-hook-backups', 'post-commit.paradigm-v3.bak'), 'utf8')).toBe(v3); // backups in the git dir

    // the user commits the migration once; afterwards commits leave the tree clean
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'chore: migrate history to git-derived']);
    expect(porcelain(root)).toBe('');
    commitIn(root, 'feat(#z): after migration\n\nSymbols: #z\n', { 'src/z.ts': '1' });
    expect(porcelain(root)).toBe('');
    const ctx = await readHistory(root);
    expect(ctx.index?.by_symbol['#z']?.total_changes).toBe(1);
    expect(ctx.index?.by_symbol['#old']?.total_changes).toBe(1); // legacy row still read
    expect(porcelain(root)).toBe('');

    // second run: nothing changes, no new backup
    const hooksBefore = fs.readdirSync(hooksDir).sort();
    const cwd2 = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      await syncCommand('claude', { mcp: false, quiet: true });
    } finally {
      cwd2.mockRestore();
    }
    await hooksInstall(root);
    expect(porcelain(root)).toBe('');
    expect(fs.readdirSync(hooksDir).sort()).toEqual(hooksBefore);
  });

  it('F6: two worktrees committing stay clean', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    await hooksInstall(root);
    const git = gitIn(root);
    const wt = path.join(base, 'wt');
    git(['worktree', 'add', '-q', '-b', 'side', wt]);
    for (let i = 0; i < 3; i++) {
      commitIn(root, `feat(#m${i}): main ${i}\n\nSymbols: #m${i}\n`, { [`src/m/${i}.ts`]: '1' });
      commitIn(wt, `feat(#w${i}): wt ${i}\n\nSymbols: #w${i}\n`, { [`src/w/${i}.ts`]: '1' });
      await readHistory(root);
      await readHistory(wt);
      expect(porcelain(root), `main ${i}`).toBe('');
      expect(porcelain(wt), `worktree ${i}`).toBe('');
    }
    const mainSyms = Object.keys((await readHistory(root)).index!.by_symbol).sort();
    const wtSyms = Object.keys((await readHistory(wt)).index!.by_symbol).sort();
    expect(mainSyms).toEqual(['#m0', '#m1', '#m2']);
    expect(wtSyms).toEqual(['#w0', '#w1', '#w2']);
  });

  it('F7: a --depth 1 clone reads as shallow and does not throw', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    for (let i = 0; i < 3; i++) commitIn(root, `feat(#d${i}): d\n\nSymbols: #d${i}\n`, { [`src/d/${i}.ts`]: '1' });
    const clone = path.join(base, 'shallow');
    const url = 'file://' + root.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:');
    execFileSync('git', ['clone', '-q', '--depth', '1', url, clone], { env });
    const ctx = await readHistory(clone);
    expect(ctx.shallow).toBe(true);
    expect(Object.keys(ctx.index!.by_symbol)).toEqual(['#d2']);
    expect(checkFragility(ctx, ['#d2']).warnings.some((w) => w.startsWith('Shallow clone'))).toBe(true);
    // the boundary commit is a root to git (its file list is the whole tree): trailer-only, no files, never cached
    const tip = gitIn(clone)(['rev-parse', 'HEAD']).trim();
    const row = loadMergedHistory(clone).entries.find((e) => e.commit === tip);
    expect(row?.files).toEqual([]);
    expect(row?.symbols).toEqual(['#d2']);
    const { historyCachePath } = await import('../../../../paradigm-mcp/src/utils/history-git.js');
    const cache = historyCachePath(clone);
    expect(fs.existsSync(cache) ? fs.readFileSync(cache, 'utf8') : '').not.toContain(tip);
    // fetch --unshallow changes no HEAD, but invalidates the index
    expect(isHistoryContextFresh(clone, ctx)).toBe(true);
    gitIn(clone)(['fetch', '-q', '--unshallow']);
    expect(isHistoryContextFresh(clone, ctx)).toBe(false);
    const full = await readHistory(clone);
    expect(full.shallow).toBe(false);
    expect(Object.keys(full.index!.by_symbol).sort()).toEqual(['#d0', '#d1', '#d2']);
    expect(porcelain(clone)).toBe('');
  });

  it('F8: a fresh clone without index.yaml still answers fragility', { timeout: T }, async () => {
    const root = initProject(path.join(base, 'repo'));
    await hooksInstall(root);
    commitIn(root, 'feat(#fx): one\n\nSymbols: #fx\n', { 'src/f.ts': '1' });
    // two authored rollbacks make #fx fragile
    const { historyRecordCommand } = await import('./index.js');
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      await historyRecordCommand({ type: 'rollback', symbols: '#fx', description: 'r1', reason: 'x' });
      await historyRecordCommand({ type: 'rollback', symbols: '#fx', description: 'r2', reason: 'y' });
    } finally {
      cwd.mockRestore();
    }
    commitIn(root, 'chore: record rollbacks', {});
    await readHistory(root); // writes the ignored index in the source repo only
    const clone = path.join(base, 'clone');
    execFileSync('git', ['clone', '-q', root, clone], { env });
    expect(fs.existsSync(path.join(clone, '.paradigm', 'history', 'index.yaml'))).toBe(false);
    const ctx = await readHistory(clone);
    const check = checkFragility(ctx, ['#fx']);
    expect(check.warnings.join(' ')).not.toContain('No history index');
    expect(check.fragile.map((f) => f.symbol)).toEqual(['#fx']);
    expect(fs.existsSync(path.join(clone, '.paradigm', 'history', 'index.yaml'))).toBe(true); // generated, ignored
    expect(porcelain(clone)).toBe('');
  });
});

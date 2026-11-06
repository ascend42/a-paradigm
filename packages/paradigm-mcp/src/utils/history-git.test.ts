/**
 * #history-git / #history-loader: history derived from git (T-2026-11-06-001).
 * Real git in temp repositories, no shell; runs the same on Windows.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  historyGitEnv,
  __setHistoryGitFaultsForTests,
  matchPurposeItems,
  purposeItems,
  deriveCommitEntries,
  historyCachePath,
  parseCommitLog,
  purposeSymbols,
  trailerSymbols,
  isAgentCommit,
} from './history-git.js';
import { loadMergedHistory, newHistoryId, recordHistoryEntry, resolveHistoryId, ensureHistoryIndex, canWriteHistoryIndex, currentHistoryStamp, __setAfterLogReadHookForTests } from './history-loader.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmp(prefix = 'pdg-hg-'): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

/** git with no global/system config (no signing, templates or hooksPath from the developer's machine). */
function gitEnv(): NodeJS.ProcessEnv {
  const cfg = path.join(tmp('pdg-hg-cfg-'), 'gitconfig');
  fs.writeFileSync(cfg, '');
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: cfg,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Ada',
    GIT_AUTHOR_EMAIL: 'ada@example.com',
    GIT_COMMITTER_NAME: 'Ada',
    GIT_COMMITTER_EMAIL: 'ada@example.com',
  };
}

function repo(): { root: string; git: (args: string[], input?: string) => string; commit: (msg: string, files?: Record<string, string>) => string } {
  const root = tmp();
  const env = gitEnv();
  const git = (args: string[], input?: string) =>
    execFileSync('git', args, { cwd: root, env, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-q', '-b', 'main']);
  const commit = (msg: string, files: Record<string, string> = {}) => {
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), c);
    }
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-F', '-'], msg);
    return git(['rev-parse', 'HEAD']).trim();
  };
  return { root, git, commit };
}

describe('parsing', () => {
  it('trailerSymbols reads EVERY Symbols: line (GitHub squash bodies) and ignores an empty one', () => {
    const body = [
      'feat(#a): squash of three (#42)',
      '',
      '* feat(#a): one',
      '',
      'Symbols: #a, $flow-a',
      '',
      '* fix(#b): two',
      '',
      'Symbols: #b,^gate-b',
      '',
      '* chore: three',
      '',
      'Symbols:',
      '',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
    ].join('\n');
    expect(trailerSymbols(body)).toEqual(['#a', '#b', '$flow-a', '^gate-b']);
    expect(trailerSymbols('fix: x\n\nSymbols:\n')).toEqual([]);
    expect(trailerSymbols('fix: x\n\nSymbols: not-a-symbol, #ok')).toEqual(['#ok']);
    expect(isAgentCommit(body)).toBe(true);
    expect(isAgentCommit('fix: x\n\nCo-Authored-By: Bob <bob@example.com>')).toBe(false);
  });

  it('purposeSymbols reads today\'s map-shaped .purpose and the older list shape', () => {
    const map = 'version: 2.0.0\ncomponents:\n  login-form:\n    description: x\n  "#already":\n    description: y\ngates:\n  authenticated:\n    description: z\nflows:\n  checkout-flow: {}\nsignals:\n  login-success: {}\naspects:\n  audit: {}\n';
    expect(purposeSymbols(map)).toEqual(['!login-success', '#already', '#login-form', '$checkout-flow', '^authenticated', '~audit']);
    const list = 'features:\n  - name: search\ncomponents:\n  - id: card\n';
    expect(purposeSymbols(list)).toEqual(['#card', '#search']);
    expect(purposeSymbols('"#top-level":\n  description: v2 shape\n')).toEqual(['#top-level']);
    expect(purposeSymbols(': : bad yaml [')).toEqual([]);
  });

  it('parseCommitLog keeps each file list inside its own record', () => {
    const raw = '\x1eaaa\x1fAda\x1f2026-01-01T00:00:00Z\x1ffeat: one\n\nSymbols: #a\n\x1f\n\nsrc/a.ts\nsrc/b.ts\n\x1ebbb\x1fBob\x1f2026-01-02T00:00:00Z\x1fmerge\n\x1f\n';
    const out = parseCommitLog(raw);
    expect(out.map((c) => [c.sha, c.files])).toEqual([['aaa', ['src/a.ts', 'src/b.ts']], ['bbb', []]]);
    expect(out[0].message).toBe('feat: one\n\nSymbols: #a');
  });
});

describe('deriveCommitEntries', () => {
  it('derives a squash body with several trailers, a merge commit and an empty trailer', () => {
    const { root, git, commit } = repo();
    commit('chore: base', { 'README.md': 'x' });
    const squash = commit('feat(#a): squash (#7)\n\n* one\n\nSymbols: #a\n\n* two\n\nSymbols: #b, #c\n', { 'src/a.ts': '1' });
    git(['checkout', '-q', '-b', 'side']);
    const side = commit('fix(#d): side\n\nSymbols: #d\n', { 'src/d.ts': '1' });
    git(['checkout', '-q', 'main']);
    commit('feat: main moves\n\nSymbols: #e\n', { 'src/e.ts': '1' });
    git(['merge', '-q', '--no-ff', 'side', '-m', 'Merge branch side\n\nSymbols: #m']);
    const merge = git(['rev-parse', 'HEAD']).trim();
    const empty = commit('docs: nothing\n\nSymbols:\n', { 'notes.txt': 'x' });

    const d = deriveCommitEntries(root);
    const bySha = new Map(d.entries.map((e) => [e.commit, e]));
    expect(bySha.get(squash)?.symbols).toEqual(['#a', '#b', '#c']);
    expect(bySha.get(squash)?.id).toBe(`h-${squash.slice(0, 12)}`);
    expect(bySha.get(squash)?.source).toBe('git');
    expect(bySha.get(squash)?.files).toEqual(['src/a.ts']);
    expect(bySha.get(side)?.symbols).toEqual(['#d']);
    expect(bySha.get(merge)?.symbols).toEqual(['#m']);
    expect(bySha.get(merge)?.files).toEqual([]);
    expect(bySha.has(empty)).toBe(false); // no trailer symbol, no covering .purpose
    expect(d.shallow).toBe(false);
    expect(new Set(d.entries.map((e) => e.id)).size).toBe(d.entries.length);
  });

  it('falls back to the nearest .purpose AT THAT SHA when a commit has no trailer', () => {
    const { root, commit } = repo();
    commit('chore: add purpose', { 'src/auth/.purpose': 'components:\n  login-form: {file: x.ts}\n', 'src/auth/x.ts': '1' });
    const first = commit('fix: tweak login', { 'src/auth/x.ts': '2' });
    // the .purpose changes later; the earlier commit keeps the symbols it had then
    commit('chore: rename', { 'src/auth/.purpose': 'components:\n  signin-form: {file: x.ts}\n' });
    const later = commit('fix: tweak again', { 'src/auth/x.ts': '3' });
    const rootLevel = commit('fix: root only', { 'top.txt': '1' });
    const bySha = new Map(deriveCommitEntries(root).entries.map((e) => [e.commit, e]));
    expect(bySha.get(first)?.symbols).toEqual(['#login-form']);
    expect(bySha.get(later)?.symbols).toEqual(['#signin-form']);
    expect(bySha.has(rootLevel)).toBe(false);
  });

  it('narrows the fallback to the component whose declared file the commit touched', () => {
    const { root, commit } = repo();
    const purpose = [
      'components:',
      '  login-form:',
      '    file: login-form.ts',
      '  signup-form:',
      '    file: signup-form.ts',
      '  session-store:',
      '    files: [store/session.ts]',
      '  oauth:',
      '    path: packages/app/src/auth/oauth',
      'gates:',
      '  authenticated: {}',
      '',
    ].join('\n');
    commit('chore: add auth', { 'packages/app/src/auth/.purpose': purpose, 'packages/app/src/auth/login-form.ts': '1', 'packages/app/src/auth/signup-form.ts': '1', 'packages/app/src/auth/store/session.ts': '1', 'packages/app/src/auth/oauth/x.ts': '1', 'packages/app/src/auth/other/y.ts': '1' });
    const login = commit('fix: login tweak', { 'packages/app/src/auth/login-form.ts': '2' });
    const store = commit('fix: store tweak', { 'packages/app/src/auth/store/session.ts': '2' });
    const oauth = commit('fix: oauth tweak', { 'packages/app/src/auth/oauth/x.ts': '2' });
    const other = commit('fix: unrelated file', { 'packages/app/src/auth/other/y.ts': '2' });
    const bySha = new Map(deriveCommitEntries(root).entries.map((e) => [e.commit, e]));
    // the path-less ^authenticated matches only a file named authenticated.*
    expect(bySha.get(login)?.symbols).toEqual(['#login-form']);
    expect(bySha.get(store)?.symbols).toEqual(['#session-store']);
    expect(bySha.get(oauth)?.symbols).toEqual(['#oauth']);
    expect(bySha.has(other)).toBe(false); // nothing matches: no symbols, never every component
    expect(matchPurposeItems(purposeItems(purpose), 'packages/app/src/auth', 'packages/app/src/auth/signup-form.ts')).toEqual(['#signup-form']);
  });

  it('a path-less .purpose tags only the component whose id is the changed file stem', () => {
    const { root, commit } = repo();
    const ids = ['login', 'logout', 'signup', 'session', 'token', 'profile', 'settings', 'audit'];
    const purpose = 'components:\n' + ids.map((i) => `  ${i}:\n    description: ${i}\n`).join('');
    commit('chore: add', { 'src/auth/.purpose': purpose, 'src/auth/login.ts': '1', 'src/auth/helpers.ts': '1' });
    const login = commit('fix: login', { 'src/auth/login.ts': '2' });
    const helpers = commit('fix: helpers', { 'src/auth/helpers.ts': '2' });
    const bySha = new Map(deriveCommitEntries(root).entries.map((e) => [e.commit, e]));
    expect(bySha.get(login)?.symbols).toEqual(['#login']);
    expect(bySha.has(helpers)).toBe(false);
  });

  it('reads CRLF commit bodies: trailers and Co-Authored-By survive', () => {
    const { root, commit } = repo();
    const sha = commit('feat: crlf\r\n\r\nSymbols: #crlf-a, #crlf-b\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n', { 'c.txt': '1' });
    const row = deriveCommitEntries(root).entries.find((e) => e.commit === sha);
    expect(row?.symbols).toEqual(['#crlf-a', '#crlf-b']);
    expect(row?.author.type).toBe('agent');
    expect(row?.description).toBe('feat: crlf');
    expect(trailerSymbols('x\r\nSymbols: #a\r\n')).toEqual(['#a']);
    expect(isAgentCommit('x\r\nCo-Authored-By: Claude <noreply@anthropic.com>\r\n')).toBe(true);
  });

  it('a git failure is never cached as truth: a failed .purpose lookup is retried, a failed rev-list is incomplete', () => {
    const { root, commit } = repo();
    commit('chore: add', { 'src/a/.purpose': 'components:\n  alpha: {file: alpha.ts}\n', 'src/a/alpha.ts': '1' });
    const sha = commit('fix: alpha', { 'src/a/alpha.ts': '2' });
    __setHistoryGitFaultsForTests({ catFile: true });
    try {
      const bad = deriveCommitEntries(root);
      expect(bad.complete).toBe(false);
      expect(bad.entries.some((e) => e.commit === sha)).toBe(false);
    } finally {
      __setHistoryGitFaultsForTests({});
    }
    const good = deriveCommitEntries(root);
    expect(good.complete).toBe(true);
    expect(good.entries.find((e) => e.commit === sha)?.symbols).toEqual(['#alpha']);
    __setHistoryGitFaultsForTests({ revList: true });
    try {
      expect(deriveCommitEntries(root).complete).toBe(false);
    } finally {
      __setHistoryGitFaultsForTests({});
    }
  });

  it('a .purpose blob missing locally (partial clone) leaves the commit underived and uncached', () => {
    const { root, git, commit } = repo();
    commit('chore: add', { 'src/a/.purpose': 'components:\n  alpha: {file: alpha.ts}\n', 'src/a/alpha.ts': '1' });
    const sha = commit('fix: alpha', { 'src/a/alpha.ts': '2' });
    const blob = git(['rev-parse', 'HEAD:src/a/.purpose']).trim();
    fs.rmSync(path.join(root, '.git', 'objects', blob.slice(0, 2), blob.slice(2)), { force: true });
    const d = deriveCommitEntries(root);
    expect(d.complete).toBe(false);
    expect(d.entries.some((e) => e.commit === sha)).toBe(false);
    const cache = historyCachePath(root);
    expect(fs.existsSync(cache) ? fs.readFileSync(cache, 'utf8') : '').not.toContain(sha);
  });

  it('in a partial clone a missing candidate folder fails closed (uncached, incomplete); elsewhere it reads as no .purpose', () => {
    const { root, git, commit } = repo();
    commit('chore: add', { 'src/a/alpha.ts': '1' });
    const sha = commit('chore: delete', {});
    void sha;
    fs.rmSync(path.join(root, 'src'), { recursive: true });
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'chore: remove src']);
    const removed = git(['rev-parse', 'HEAD']).trim(); // touches src/a/alpha.ts, whose folder is gone at that commit
    const plain = deriveCommitEntries(root);
    expect(plain.complete).toBe(true);
    const cache = historyCachePath(root);
    expect(fs.readFileSync(cache, 'utf8')).toContain(removed); // cached as "no symbols"
    fs.rmSync(cache);
    git(['config', 'extensions.partialclone', 'origin']);
    const partial = deriveCommitEntries(root);
    expect(partial.complete).toBe(false);
    expect(fs.existsSync(cache) ? fs.readFileSync(cache, 'utf8') : '').not.toContain(removed);
  });

  it('compaction keeps the newest unreachable rows (the cache is shared by worktrees)', () => {
    const { root, commit } = repo();
    const sha = commit('feat: a\n\nSymbols: #a\n', { 'a.txt': '1' });
    const cache = historyCachePath(root);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    const other = ['1', '2', '3', '4', '5'].map((c) => c.repeat(40));
    fs.writeFileSync(cache, other.map((s) => JSON.stringify({ v: 2, sha: s, entry: null })).join('\n') + '\n');
    deriveCommitEntries(root, { compact: { trigger: 3, keep: 2 } });
    const shas = fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).sha);
    expect(shas.sort()).toEqual([other[3], other[4], sha].sort());
  });

  it('chunks and bounds the work per call, appending to the cache as it goes', () => {
    const { root, commit } = repo();
    for (let i = 0; i < 5; i++) commit(`feat: ${i}\n\nSymbols: #c${i}\n`, { [`${i}.txt`]: '1' });
    const first = deriveCommitEntries(root, { chunk: 2, maxPerCall: 3 });
    expect(first.complete).toBe(false);
    expect(first.entries).toHaveLength(3);
    expect(fs.readFileSync(historyCachePath(root), 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
    const second = deriveCommitEntries(root, { chunk: 2, maxPerCall: 3 });
    expect(second.complete).toBe(true);
    expect(second.entries).toHaveLength(5);
  });

  it('compacts the cache when rows of another version are present', () => {
    const { root, commit } = repo();
    const sha = commit('feat: a\n\nSymbols: #a\n', { 'a.txt': '1' });
    const cache = historyCachePath(root);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ v: 1, sha, entry: null }) + '\n' + JSON.stringify({ v: 1, sha: 'd'.repeat(40), entry: null }) + '\n');
    expect(deriveCommitEntries(root).entries.map((e) => e.commit)).toEqual([sha]);
    const rows = fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(rows.every((r) => r.v === 2)).toBe(true);
    expect(rows.map((r) => r.sha)).toEqual([sha]);
  });

  it('reads never prompt or lazy-fetch and ignore an inherited GIT_DIR', () => {
    const env = historyGitEnv();
    expect(env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(env.GIT_NO_LAZY_FETCH).toBe('1');
    const prev = process.env.GIT_DIR;
    process.env.GIT_DIR = '/elsewhere/.git';
    try {
      expect(historyGitEnv().GIT_DIR).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prev;
    }
  });

  it('is incremental: cached SHAs are not derived again; unreachable cached rows are filtered', () => {
    const { root, git, commit } = repo();
    commit('feat: a\n\nSymbols: #a\n', { 'a.txt': '1' });
    const old = commit('feat: b\n\nSymbols: #b\n', { 'b.txt': '1' });
    const first = deriveCommitEntries(root);
    expect(first.entries).toHaveLength(2);
    const cache = historyCachePath(root);
    const rowsAfterFirst = fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean).length;
    expect(rowsAfterFirst).toBe(2);
    // nothing new: no cache growth
    deriveCommitEntries(root);
    expect(fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean).length).toBe(rowsAfterFirst);
    // amend: the old SHA stays cached but is no longer reachable
    git(['commit', '-q', '--amend', '-F', '-'], 'feat: b amended\n\nSymbols: #b2\n');
    const amended = git(['rev-parse', 'HEAD']).trim();
    const after = deriveCommitEntries(root);
    expect(after.entries.map((e) => e.commit)).toContain(amended);
    expect(after.entries.map((e) => e.commit)).not.toContain(old);
    expect(fs.readFileSync(cache, 'utf8').split('\n').filter(Boolean).length).toBe(3);
  });

  it('returns nothing outside git or before the first commit (never throws)', () => {
    expect(deriveCommitEntries(tmp()).entries).toEqual([]);
    const { root } = repo();
    expect(deriveCommitEntries(root)).toEqual({ entries: [], shallow: false, head: null, complete: true });
  });
});

describe('loadMergedHistory', () => {
  it('dedupes by commit (the legacy row wins) and disambiguates duplicate legacy ids as id@sha7', async () => {
    const { root, commit } = repo();
    const c1 = commit('feat: one\n\nSymbols: #a\n', { 'a.txt': '1' });
    const c2 = commit('feat: two\n\nSymbols: #b\n', { 'b.txt': '1' });
    const c3 = commit('feat: three\n\nSymbols: #c\n', { 'c.txt': '1' });
    fs.mkdirSync(path.join(root, '.paradigm', 'history'), { recursive: true });
    // two branches once minted the same h0002 for different commits (the old wc -l + 1 rule)
    const legacy = [
      { id: 'h0001', ts: '2026-01-01T00:00:00Z', type: 'implement', symbols: ['#a'], author: { type: 'human', id: 'ada' }, commit: c1 },
      { id: 'h0002', ts: '2026-01-02T00:00:00Z', type: 'implement', symbols: ['#b'], author: { type: 'human', id: 'ada' }, commit: c2 },
      { id: 'h0002', ts: '2026-01-03T00:00:00Z', type: 'implement', symbols: ['#x'], author: { type: 'human', id: 'bob' }, commit: 'f'.repeat(40) },
    ];
    fs.writeFileSync(path.join(root, '.paradigm', 'history', 'log.jsonl'), legacy.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const authoredId = await recordHistoryEntry(root, { type: 'rollback', symbols: ['#c'], author: { type: 'agent', id: 'claude' }, reason: 'r' });

    const { entries } = loadMergedHistory(root);
    const byCommit = (c: string) => entries.filter((e) => e.commit === c);
    expect(byCommit(c1)).toHaveLength(1);
    expect(byCommit(c1)[0]).toMatchObject({ id: 'h0001', source: 'legacy' });
    expect(byCommit(c2)[0]).toMatchObject({ id: `h0002@${c2.slice(0, 7)}`, source: 'legacy' });
    expect(byCommit(c3)[0]).toMatchObject({ id: `h-${c3.slice(0, 12)}`, source: 'git' });
    expect(entries.find((e) => e.id === authoredId)?.source).toBe('authored');
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(resolveHistoryId(entries, 'h0001')?.commit).toBe(c1);
    expect(resolveHistoryId(entries, `h0002@${c2.slice(0, 7)}`)?.commit).toBe(c2);
    expect(resolveHistoryId(entries, 'h0002')).toBeNull(); // ambiguous bare id
  });

  it('writes index.yaml only when git ignores it', () => {
    const { root, commit } = repo();
    fs.mkdirSync(path.join(root, '.paradigm', 'history'), { recursive: true });
    commit('feat: one\n\nSymbols: #a\n', { 'a.txt': '1', '.paradigm/config.yaml': 'v: 1\n' });
    const indexFile = path.join(root, '.paradigm', 'history', 'index.yaml');
    expect(canWriteHistoryIndex(root)).toBe(false);
    expect(Object.keys(ensureHistoryIndex(root).by_symbol)).toEqual(['#a']);
    expect(fs.existsSync(indexFile)).toBe(false); // not ignored: computed, never written
    fs.writeFileSync(path.join(root, '.paradigm', '.gitignore'), '/history/index.yaml\n');
    expect(canWriteHistoryIndex(root)).toBe(true);
    ensureHistoryIndex(root);
    expect(fs.existsSync(indexFile)).toBe(true);
  });
});

describe('index write safety', () => {
  it('an incomplete derivation is neither written nor stamped fresh', () => {
    const { root, commit } = repo();
    fs.mkdirSync(path.join(root, '.paradigm', 'history'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', '.gitignore'), '/history/index.yaml\n');
    commit('feat: a\n\nSymbols: #a\n', { 'a.txt': '1' });
    const indexFile = path.join(root, '.paradigm', 'history', 'index.yaml');
    __setHistoryGitFaultsForTests({ revList: true });
    let idx;
    try {
      idx = ensureHistoryIndex(root);
    } finally {
      __setHistoryGitFaultsForTests({});
    }
    expect(idx.stamp?.head).toBeNull();
    expect(fs.existsSync(indexFile)).toBe(false);
    expect(Object.keys(ensureHistoryIndex(root).by_symbol)).toEqual(['#a']); // next read rebuilds
    expect(fs.existsSync(indexFile)).toBe(true);
  });

  it('a log.jsonl append between read and stamp leaves the index stale', () => {
    const { root, commit } = repo();
    fs.mkdirSync(path.join(root, '.paradigm', 'history'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', '.gitignore'), '/history/index.yaml\n');
    commit('chore: base', { 'a.txt': '1' });
    const logFile = path.join(root, '.paradigm', 'history', 'log.jsonl');
    __setAfterLogReadHookForTests(() => fs.appendFileSync(logFile, JSON.stringify({ id: 'h-late', ts: '2026-01-01T00:00:00Z', source: 'authored', type: 'rollback', symbols: ['#late'], author: { type: 'human', id: 't' } }) + '\n'));
    let idx;
    try {
      idx = ensureHistoryIndex(root);
    } finally {
      __setAfterLogReadHookForTests(null);
    }
    expect(idx.by_symbol['#late']).toBeUndefined();
    expect(idx.stamp?.logSize).not.toBe(currentHistoryStamp(root).logSize);
    expect(ensureHistoryIndex(root).by_symbol['#late']?.total_changes).toBe(1);
  });

  it('canWriteHistoryIndex looks at the root, not an inherited GIT_DIR', () => {
    const { root, commit } = repo();
    fs.mkdirSync(path.join(root, '.paradigm', 'history'), { recursive: true });
    commit('chore: tracked index', { '.paradigm/history/index.yaml': 'v: 1\n' });
    const other = repo();
    fs.mkdirSync(path.join(other.root, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(other.root, '.gitignore'), '.paradigm/history/index.yaml\n');
    const prev = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(other.root, '.git');
    try {
      expect(canWriteHistoryIndex(root)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = prev;
    }
    expect(canWriteHistoryIndex(tmp())).toBe(true); // not a git repository
  });
});

describe('newHistoryId', () => {
  it('never collides across two simulated branches recording at the same moments', () => {
    const ids = new Set<string>();
    const t0 = Date.UTC(2026, 10, 6);
    for (let i = 0; i < 2000; i++) {
      // branch a and branch b each record at the same millisecond
      ids.add(newHistoryId(t0 + i));
      ids.add(newHistoryId(t0 + i));
    }
    expect(ids.size).toBe(4000);
    for (const id of ids) expect(id).toMatch(/^h-[0-9a-z]{12}$/);
    // time-sortable, and never a derived h-<sha12> (the ms part starts with a non-hex letter)
    expect(newHistoryId(t0) < newHistoryId(t0 + 36 ** 4)).toBe(true);
    expect(newHistoryId(t0)[2]).toMatch(/[g-z]/);
  });
});

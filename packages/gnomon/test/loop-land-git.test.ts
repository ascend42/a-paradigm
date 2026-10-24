/**
 * #loop-land / #loop-git, the land mechanics against REAL git (build plan step 11, LP6b). Each case builds a real
 * repo, parks a loop commit in the kernel's park repo (step 10's createScratch + parkScratch, or plumbing for shapes
 * a case-insensitive scratch cannot hold) and lands it with landCommit.
 *
 *   G-LOOP-07   a human dirty file on a touched path: nothing lands; a disjoint path lands and the human's edits are
 *               byte-identical (the checkout ends with exactly the proposed bytes and nothing else)
 *   G-LOOP-09   author and committer `Gnomon Loop <loop+<id>@gnomon.invalid>`, the kernel's trailers last, forged
 *               trailer lines stripped; `git revert` of a landed commit is found (by content and by message)
 *   G-LOOP-15   the loop.landed row is written BEFORE the ref or any file moves
 *   G-LOOP-24   each refusal lands nothing: a rename, an untracked or ignored path, a gitlink, a .gitattributes
 *               attribute, a case-fold collision, a rebase in progress, an index.lock
 *   G-LOOP-25   HEAD switched or moved: nothing lands; a touched file whose bytes change between the check and the
 *               rename: nothing lands and the human's bytes stay; a CAS failure puts every file back
 *   TOCTOU      a parent swapped for a symlink during the land: nothing is written outside the repo
 */
// @gnomon-platform: darwin, linux
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeTree } from '../src/kernel/manifest/index.js';
import { createScratch, hardenedGit, parkRepoDir, parkScratch, removeScratch } from '../src/kernel/git/scratch.js';
import { findRevert, landCommit, type LandCommitInput, type LandResult } from '../src/kernel/git/land.js';
import { LoopLander } from '../src/kernel/loops/land.js';
import { effectiveAutonomy } from '../src/kernel/loops/strictness-cap.js';

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
const GENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const status = (root: string): string => git(root, 'status', '--porcelain=v1', '--untracked-files=all').split('\n').filter((l) => !l.includes('HOOK-')).join('\n');
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=Matt', '-c', 'user.email=matt@example.com', '-c', 'commit.gpgsign=false', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', ...args], { cwd, encoding: 'utf8', env: GENV });

/** Every byte under a dir (files, links, exec bits); `.git` excluded unless asked. */
function snapshot(root: string, withGit = false): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!withGit && rel === '' && e.name === '.git') continue;
      if (rel === '' && e.name.startsWith('HOOK-')) continue; // the test's own git calls run the planted hooks
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = fs.lstatSync(p);
      if (e.isSymbolicLink()) out[r] = `link:${fs.readlinkSync(p)}`;
      else if (e.isDirectory()) {
        out[`${r}/`] = 'dir';
        walk(p, r);
      } else out[r] = `${(st.mode & 0o777).toString(8)}:${createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`;
    }
  };
  walk(root, '');
  return out;
}

/** A committed repo with a hook and a reference-transaction hook that would leave marks if git ran them. */
function repo(): { root: string; base: string } {
  const root = tmp('gnomon-landrepo-');
  git(root, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), "export const x: number = 'oops';\n");
  fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 1;\n');
  fs.writeFileSync(path.join(root, 'src', 'gone.ts'), 'export const gone = 1;\n');
  fs.writeFileSync(path.join(root, 'run.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n*.log\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'init');
  for (const h of ['post-commit', 'reference-transaction', 'post-index-change', 'post-checkout']) {
    fs.writeFileSync(path.join(root, '.git', 'hooks', h), `#!/bin/sh\ntouch ${path.join(root, `HOOK-${h}`)}\n`, { mode: 0o755 });
  }
  return { root, base: git(root, 'rev-parse', 'HEAD').trim() };
}

const EMPTY_HOME = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-userhome-')));
const TRAILERS = { onBehalfOf: 'p:abcdefgh/matt', trustedBy: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ', loop: 'fixer@0123abcd', authoredBy: 'file' };

/** Park a loop commit through the real scratch: `edit` changes the scratch tree. */
function parkVia(home: string, root: string, runId: string, edit: (tree: string) => void) {
  const s = createScratch({ home, repo: root, loopId: 'fixer', runId });
  try {
    edit(s.tree);
    const p = parkScratch(s, { home, message: 'fix(#gnomon): green', loopTrailer: 'fixer@0123abcd' })!;
    return { ...p, baseSha: s.headSha, headRef: s.headRef! };
  } finally {
    removeScratch(s);
  }
}

/** Park a commit with plumbing (shapes a case-insensitive scratch cannot hold): index-info lines on the base tree. */
function parkPlumb(home: string, root: string, base: string, runId: string, entries: Array<{ path: string; content?: string; mode?: string; delete?: true }>) {
  // make sure the park repo exists (a no-op park through the scratch creates it)
  const s = createScratch({ home, repo: root, loopId: 'fixer', runId: `${runId}-init` });
  fs.writeFileSync(path.join(s.tree, 'zz-init'), 'x');
  parkScratch(s, { home, message: 'init', loopTrailer: 'fixer@0' });
  removeScratch(s);
  const park = parkRepoDir(fs.realpathSync.native(home), root);
  const index = path.join(tmp('gnomon-pidx-'), 'index');
  const env = { ...GENV, GIT_INDEX_FILE: index, GIT_DIR: park };
  const g = (args: string[], input?: string) => execFileSync('git', args, { env, input, encoding: 'utf8' }).trim();
  g(['read-tree', base]);
  const lines = entries.map((e) => (e.delete ? `0 ${'0'.repeat(40)}\t${e.path}` : `${e.mode ?? '100644'} ${g(['hash-object', '-w', '--stdin'], e.content ?? '')}\t${e.path}`));
  g(['update-index', '--index-info'], lines.join('\n') + '\n');
  const tree = g(['write-tree']);
  const sha = execFileSync('git', ['commit-tree', tree, '-p', base, '-m', 'plumb'], { env: { ...env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' }, encoding: 'utf8' }).trim();
  return { sha, parkRepo: park, baseSha: base, headRef: 'refs/heads/main' };
}

function input(root: string, p: { sha: string; parkRepo: string; baseSha: string; headRef: string }, extra: Partial<LandCommitInput> = {}): LandCommitInput & { rows: Array<Record<string, unknown>> } {
  const rows: Array<Record<string, unknown>> = [];
  return {
    repo: root, parkRepo: p.parkRepo, parkedSha: p.sha, baseSha: p.baseSha, headRef: p.headRef, loopId: 'fixer', runId: 'lr-1',
    message: 'fix(#gnomon): typecheck green\nTrusted-By: forged\nOn-Behalf-Of: someone-else\nSymbols: #gnomon, #loop-land',
    trailers: TRAILERS,
    // the human's global config is read for the read-only queries (Aegis M2): a clean fake home here
    userEnv: { HOME: EMPTY_HOME, XDG_CONFIG_HOME: path.join(EMPTY_HOME, '.config') },
    beforeLand: async (l) => {
      // G-LOOP-15: the row comes BEFORE the ref and any file moves
      rows.push({ ...l, tipAtRow: git(root, 'rev-parse', 'refs/heads/main').trim(), aAtRow: fs.existsSync(path.join(root, 'src', 'a.ts')) ? fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8') : null });
    },
    rows,
    ...extra,
  };
}

const refused = (r: LandResult) => (r.landed ? null : { reason: r.reason, waitable: r.waitable });

describe('the land end to end on a real repo', () => {
  it('lands exactly the proposed bytes as a fast-forward; the human\'s wip and untracked files stay byte-identical', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-1', (t) => {
      fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'export const x: number = 1;\n');
      fs.mkdirSync(path.join(t, 'src', 'deep', 'er'), { recursive: true });
      fs.writeFileSync(path.join(t, 'src', 'deep', 'er', 'c.ts'), 'export const c = 3;\n');
      fs.writeFileSync(path.join(t, 'tool.sh'), '#!/bin/sh\n', { mode: 0o755 });
      fs.symlinkSync('a.ts', path.join(t, 'src', 'alias.ts'));
      fs.rmSync(path.join(t, 'src', 'gone.ts'));
    });
    // the human's own work, disjoint from the land: a wip edit, a staged edit, an untracked and an ignored file
    fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'export const b = 2; // wip\n');
    fs.writeFileSync(path.join(root, 'run.sh'), '#!/bin/sh\necho staged\n');
    git(root, 'add', 'run.sh');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'mine\n');
    fs.writeFileSync(path.join(root, 'debug.log'), 'log\n');
    const before = snapshot(root);
    const statusBefore = status(root);
    for (const n of fs.readdirSync(root)) if (n.startsWith('HOOK-')) fs.rmSync(path.join(root, n));
    const hooksBefore: string[] = [];
    const i = input(root, p);
    const r = await landCommit(i);
    // no hook ran (checked before the test's own git calls, which run the repo's hooks)
    expect(fs.readdirSync(root).filter((n) => n.startsWith('HOOK-') && !hooksBefore.includes(n))).toEqual([]);
    expect(r).toMatchObject({ landed: true, baseSha: base, ref: 'refs/heads/main' });
    if (!r.landed) return;
    expect(r.paths.sort()).toEqual(['src/a.ts', 'src/alias.ts', 'src/deep/er/c.ts', 'src/gone.ts', 'tool.sh']);
    // the row came first: the branch and the file were still the base's when it was written
    expect(i.rows).toEqual([expect.objectContaining({ sha: r.sha, ref: 'refs/heads/main', baseSha: base, tipAtRow: base, aAtRow: "export const x: number = 'oops';\n" })]);
    // a fast-forward: HEAD is the land commit on the base, the kernel identity and trailers last, forged ones gone
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(r.sha);
    expect(git(root, 'rev-parse', `${r.sha}^`).trim()).toBe(base);
    expect(git(root, 'log', '-1', '--format=%an <%ae>|%cn <%ce>')).toBe('Gnomon Loop <loop+fixer@gnomon.invalid>|Gnomon Loop <loop+fixer@gnomon.invalid>\n');
    expect(git(root, 'log', '-1', '--format=%B')).toBe('fix(#gnomon): typecheck green\n\nOn-Behalf-Of: p:abcdefgh/matt\nTrusted-By: card:01HZZZZZZZZZZZZZZZZZZZZZZZ\nGnomon-Loop: fixer@0123abcd\nGnomon-Run: lr-1\nLoop-Authored-By: file\nSymbols: #gnomon, #loop-land\n\n');
    // the checkout: exactly the proposed bytes on the touched paths, nothing else moved
    const after = snapshot(root);
    const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]).sort();
    expect(changed).toEqual(['src/a.ts', 'src/alias.ts', 'src/deep/', 'src/deep/er/', 'src/deep/er/c.ts', 'src/gone.ts', 'tool.sh']);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('export const x: number = 1;\n');
    expect(fs.readlinkSync(path.join(root, 'src', 'alias.ts'))).toBe('a.ts');
    expect(fs.statSync(path.join(root, 'tool.sh')).mode & 0o111).not.toBe(0);
    expect(fs.statSync(path.join(root, 'src', 'deep', 'er', 'c.ts')).mode & 0o111).toBe(0);
    // git agrees: only the human's own changes are left, the index matches HEAD for the touched paths
    expect(status(root)).toBe(statusBefore);
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('run.sh\n');
    // no temp or lock left in the checkout or .git
    expect(fs.existsSync(path.join(root, '.git', 'index.lock'))).toBe(false);
    expect(fs.readdirSync(path.join(root, '.git')).filter((n) => n.startsWith('gnomon-land'))).toEqual([]);
    expect(Object.keys(after).filter((k) => k.includes('.gnomon-land-'))).toEqual([]);
    expect(git(root, 'fsck', '--no-progress', '--connectivity-only').trim()).toBe('');
    // G-LOOP-09: a git revert of the landed commit is found by content (and the message line names it)
    expect(findRevert(root, r.sha, 'refs/heads/main')).toBeNull();
    git(root, 'reset', '-q', '--hard'); // the test's temp repo: clear the wip so the revert applies
    git(root, 'clean', '-fdq');
    git(root, 'revert', '--no-edit', r.sha);
    expect(findRevert(root, r.sha, 'refs/heads/main')).toMatchObject({ detectedBy: 'content', sha: git(root, 'rev-parse', 'HEAD').trim() });
  });

  it('a revert by hand (same content, no message) is found by content; a message-only claim is found by message', async () => {
    const { root } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-2', (t) => fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'export const x: number = 2;\n'));
    const r = await landCommit(input(root, p));
    if (!r.landed) throw new Error(JSON.stringify(r));
    git(root, 'commit', '-q', '--allow-empty', '-m', `chore: unrelated\n\nThis reverts commit ${r.sha}.`);
    expect(findRevert(root, r.sha, 'refs/heads/main')).toMatchObject({ detectedBy: 'message' });
    const { root: r2 } = repo();
    const p2 = parkVia(home, r2, 'lr-3', (t) => fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'export const x: number = 3;\n'));
    const l2 = await landCommit(input(r2, p2));
    if (!l2.landed) throw new Error(JSON.stringify(l2));
    fs.writeFileSync(path.join(r2, 'src', 'a.ts'), "export const x: number = 'oops';\n");
    git(r2, 'commit', '-q', '-am', 'put it back');
    expect(findRevert(r2, l2.sha, 'refs/heads/main')).toMatchObject({ detectedBy: 'content' });
    // a rewrite (reset) is not a revert
    git(r2, 'reset', '-q', '--hard', `${l2.sha}^`);
    expect(findRevert(r2, l2.sha, 'refs/heads/main')).toBeNull();
  });
});

describe('refusals land nothing (G-LOOP-07, G-LOOP-24, G-LOOP-25)', () => {
  const setup = (edit: (t: string) => void = (t) => fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'export const x: number = 1;\n')) => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-r', edit);
    return { root, base, home, p };
  };
  const unchanged = async (root: string, base: string, run: () => Promise<LandResult>) => {
    const before = snapshot(root);
    const r = await run();
    expect(git(root, 'rev-parse', 'refs/heads/main').trim() === base || !r.landed).toBe(true);
    expect(r.landed).toBe(false);
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, '.git', 'index.lock')) && !r.landed && (r as any).reason !== 'index-lock').toBe(false);
    expect(fs.readdirSync(path.join(root, '.git')).filter((n) => n.startsWith('gnomon-land'))).toEqual([]);
    return r;
  };

  it('a dirty touched path (worktree or staged) waits; the human\'s bytes stay', async () => {
    const { root, base, p } = setup();
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'human edit\n');
    const i = input(root, p);
    expect(refused(await unchanged(root, base, () => landCommit(i)))).toEqual({ reason: 'dirty', waitable: true });
    expect(i.rows).toEqual([]);
    git(root, 'add', 'src/a.ts');
    expect(refused(await unchanged(root, base, () => landCommit(input(root, p))))).toEqual({ reason: 'dirty', waitable: true });
  });

  it('HEAD moved since the base, a detached HEAD and another branch: nothing lands on either branch', async () => {
    const { root, base, p } = setup();
    git(root, 'checkout', '-q', '--detach');
    expect(await unchanged(root, base, () => landCommit(input(root, p)))).toMatchObject({ reason: 'branch-moved', detail: 'HEAD is detached' });
    git(root, 'checkout', '-q', '-b', 'other');
    expect(await unchanged(root, base, () => landCommit(input(root, p)))).toMatchObject({ reason: 'branch-moved', detail: expect.stringContaining('HEAD is on "refs/heads/other"') });
    expect(git(root, 'rev-parse', 'refs/heads/other').trim()).toBe(base);
    git(root, 'checkout', '-q', 'main');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'human moved on');
    const moved = git(root, 'rev-parse', 'HEAD').trim();
    const r = await landCommit(input(root, p));
    expect(r).toMatchObject({ landed: false, reason: 'branch-moved', waitable: false });
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(moved);
  });

  it('a rebase in progress and an index.lock wait', async () => {
    const { root, base, p } = setup();
    fs.mkdirSync(path.join(root, '.git', 'rebase-merge'));
    expect(refused(await unchanged(root, base, () => landCommit(input(root, p))))).toEqual({ reason: 'in-progress', waitable: true });
    fs.rmdirSync(path.join(root, '.git', 'rebase-merge'));
    fs.writeFileSync(path.join(root, '.git', 'index.lock'), '');
    expect(refused(await unchanged(root, base, () => landCommit(input(root, p))))).toEqual({ reason: 'index-lock', waitable: true });
    expect(fs.existsSync(path.join(root, '.git', 'index.lock'))).toBe(true); // the human's lock is never removed
    fs.rmSync(path.join(root, '.git', 'index.lock'));
    expect(refused(await unchanged(root, base, () => landCommit(input(root, p, { humanBusy: () => true }))))).toEqual({ reason: 'human-turn', waitable: true });
  });

  it('an untracked or ignored file where an add lands, an attribute, a rename, a case-fold collision, a gitlink', async () => {
    const { root, base, home } = setup();
    const add = parkVia(home, root, 'lr-add', (t) => fs.writeFileSync(path.join(t, 'src', 'new.ts'), 'x\n'));
    fs.writeFileSync(path.join(root, 'src', 'new.ts'), 'the human\'s untracked file\n');
    expect(refused(await unchanged(root, base, () => landCommit(input(root, add))))).toEqual({ reason: 'untracked', waitable: true });
    fs.rmSync(path.join(root, 'src', 'new.ts'));
    const log = parkPlumb(home, root, base, 'lr-log', [{ path: 'src/trace.log', content: 'x\n' }]);
    expect(refused(await unchanged(root, base, () => landCommit(input(root, log))))).toEqual({ reason: 'ignored', waitable: false });
    fs.writeFileSync(path.join(root, '.git', 'info', 'attributes'), '*.ts text eol=crlf\n');
    expect(refused(await unchanged(root, base, () => landCommit(input(root, add))))).toEqual({ reason: 'attributes', waitable: false });
    fs.rmSync(path.join(root, '.git', 'info', 'attributes'));
    const ren = parkPlumb(home, root, base, 'lr-ren', [{ path: 'src/b.ts', delete: true }, { path: 'src/b2.ts', content: 'export const b = 1;\n' }]);
    expect(refused(await unchanged(root, base, () => landCommit(input(root, ren))))).toEqual({ reason: 'rename', waitable: false });
    const fold = parkPlumb(home, root, base, 'lr-fold', [{ path: 'SRC/x.ts', content: 'x\n' }]);
    expect(refused(await unchanged(root, base, () => landCommit(input(root, fold))))).toEqual({ reason: 'case-fold', waitable: false });
    const nfd = parkPlumb(home, root, base, 'lr-nfd', [{ path: 'src/A.ts', content: 'x\n' }]);
    expect(refused(await unchanged(root, base, () => landCommit(input(root, nfd))))).toEqual({ reason: 'case-fold', waitable: false });
  });

  it('a gitlink above a touched path', async () => {
    const { root } = repo();
    const home = tmp('gnomon-home-');
    const sub = git(root, 'rev-parse', 'HEAD').trim();
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${sub},vendor`);
    git(root, 'commit', '-q', '-m', 'a submodule');
    const base = git(root, 'rev-parse', 'HEAD').trim();
    const p = parkPlumb(home, root, base, 'lr-gl', [{ path: 'vendor', delete: true }, { path: 'vendor/x.ts', content: 'x\n' }]);
    expect(refused(await unchanged(root, base, () => landCommit(input(root, p))))).toEqual({ reason: 'gitlink', waitable: false });
  });
});

describe('races during the land (G-LOOP-25, TOCTOU)', () => {
  const two = (t: string) => {
    fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'export const x: number = 1;\n');
    fs.writeFileSync(path.join(t, 'src', 'b.ts'), 'export const b = 9;\n');
    fs.mkdirSync(path.join(t, 'src', 'sub'));
    fs.writeFileSync(path.join(t, 'src', 'sub', 'c.ts'), 'c\n');
  };

  it('a concurrent human edit after the row: nothing lands, every placed file goes back, the human\'s bytes stay', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-c', two);
    const before = snapshot(root);
    const r = await landCommit(input(root, p, {
      step: (name) => {
        if (name === 'landed-row') fs.writeFileSync(path.join(root, 'src', 'b.ts'), 'the human typed this\n');
      },
    }));
    expect(r).toMatchObject({ landed: false, reason: 'bytes-changed', undone: true });
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    expect(fs.readFileSync(path.join(root, 'src', 'b.ts'), 'utf8')).toBe('the human typed this\n');
    expect(snapshot(root)).toEqual({ ...before, 'src/b.ts': snapshot(root)['src/b.ts'] });
    expect(fs.existsSync(path.join(root, 'src', 'sub'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.git', 'index.lock'))).toBe(false);
  });

  it('a CAS failure (the branch moved after the files were placed) puts every file back', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-cas', two);
    const before = snapshot(root);
    let moved = '';
    const r = await landCommit(input(root, p, {
      step: (name) => {
        if (name !== 'placed') return;
        // another writer moves the branch (update-ref takes the ref lock, not index.lock)
        const tree = git(root, 'rev-parse', `${base}^{tree}`).trim();
        moved = execFileSync('git', ['commit-tree', tree, '-p', base, '-m', 'elsewhere'], { cwd: root, encoding: 'utf8', env: { ...GENV, GIT_AUTHOR_NAME: 'o', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'o', GIT_COMMITTER_EMAIL: 'o@o' } }).trim();
        git(root, 'update-ref', 'refs/heads/main', moved, base);
      },
    }));
    expect(r).toMatchObject({ landed: false, reason: 'branch-moved', undone: true });
    expect(git(root, 'rev-parse', 'refs/heads/main').trim()).toBe(moved);
    expect(snapshot(root)).toEqual(before);
  });

  it('a parent dir swapped for a symlink out of the repo after the check: nothing is written outside', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const outside = tmp('gnomon-outside-');
    fs.mkdirSync(path.join(outside, 'sub'));
    const p = parkVia(home, root, 'lr-t', two);
    const r = await landCommit(input(root, p, {
      step: (name) => {
        if (name !== 'checked') return;
        fs.renameSync(path.join(root, 'src'), path.join(root, 'src.real'));
        fs.symlinkSync(outside, path.join(root, 'src'), 'dir');
      },
    }));
    expect(r).toMatchObject({ landed: false, reason: 'bytes-changed' });
    expect(fs.readdirSync(outside)).toEqual(['sub']);
    expect(fs.readdirSync(path.join(outside, 'sub'))).toEqual([]);
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    // and a swap after the row (between placing two files) is caught too, and the first file is put back
    fs.rmSync(path.join(root, 'src'));
    fs.renameSync(path.join(root, 'src.real'), path.join(root, 'src'));
    const before = snapshot(root);
    let n = 0;
    const r2 = await landCommit(input(root, p, {
      step: (name) => {
        if (name !== 'landed-row' || n++) return;
        fs.renameSync(path.join(root, 'src'), path.join(root, 'src.real'));
        fs.symlinkSync(outside, path.join(root, 'src'), 'dir');
      },
    }));
    expect(r2).toMatchObject({ landed: false, reason: 'bytes-changed', undone: true });
    expect(fs.readdirSync(outside)).toEqual(['sub']);
    fs.rmSync(path.join(root, 'src'));
    fs.renameSync(path.join(root, 'src.real'), path.join(root, 'src'));
    expect(snapshot(root)).toEqual(before);
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    expect(hardenedGit(['rev-parse', 'HEAD'], { cwd: root }).stdout.toString('utf8').trim()).toBe(base);
  });
});

// ── the Aegis step-11 review fixes ──────────────────────────────────────────────────────────────────────────────

const indexBytes = (root: string): string => createHash('sha256').update(fs.readFileSync(path.join(root, '.git', 'index'))).digest('hex');
const oneFile = (t: string) => fs.writeFileSync(path.join(t, 'src', 'a.ts'), 'export const x: number = 1;\n');

describe('H1: the index is written and verified before the ref moves', () => {
  it('short writes still land a valid index', async () => {
    const { root } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-sw', oneFile);
    const r = await landCommit(input(root, p, { io: { writeSync: (fd, b, off, len) => fs.writeSync(fd, b, off, Math.min(len, 7), off) } }));
    expect(r.landed).toBe(true);
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');
    expect(status(root)).toBe('');
  });

  it('ENOSPC on the index write: nothing lands (ref, files and index unchanged, the lock released)', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-ns', oneFile);
    const before = snapshot(root);
    const idx = indexBytes(root);
    const r = await landCommit(input(root, p, { io: { writeSync: () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); } } }));
    expect(r).toMatchObject({ landed: false, undone: true });
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    expect(snapshot(root)).toEqual(before);
    expect(indexBytes(root)).toBe(idx);
    expect(fs.existsSync(path.join(root, '.git', 'index.lock'))).toBe(false);
  });

  it('a failed rename after the CAS puts the ref and the files back and reports undone, never landed', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-rn', oneFile);
    const before = snapshot(root);
    const r = await landCommit(input(root, p, { io: { renameSync: () => { throw new Error('EIO'); } } }));
    expect(r).toMatchObject({ landed: false, undone: true });
    expect(git(root, 'rev-parse', 'HEAD').trim()).toBe(base);
    expect(snapshot(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, '.git', 'index.lock'))).toBe(false);
  });

  it('L2: the ref moved again before the undo: a conflict is reported and the files are left as placed', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-cf', oneFile);
    let other = '';
    const r = await landCommit(input(root, p, {
      io: {
        renameSync: () => {
          const tree = git(root, 'rev-parse', `${base}^{tree}`).trim();
          other = execFileSync('git', ['commit-tree', tree, '-p', base, '-m', 'x'], { cwd: root, encoding: 'utf8', env: { ...GENV, GIT_AUTHOR_NAME: 'o', GIT_AUTHOR_EMAIL: 'o@o', GIT_COMMITTER_NAME: 'o', GIT_COMMITTER_EMAIL: 'o@o' } }).trim();
          git(root, 'update-ref', 'refs/heads/main', other);
          throw new Error('EIO');
        },
      },
    }));
    expect(r).toMatchObject({ landed: false, conflict: true, reason: 'branch-moved' });
    expect(git(root, 'rev-parse', 'refs/heads/main').trim()).toBe(other);
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('export const x: number = 1;\n');
  });
});

describe('H2: racy git', () => {
  it('a racily clean entry the human changed stays visible as modified after the land', async () => {
    const { root } = repo();
    const home = tmp('gnomon-home-');
    git(root, 'config', 'core.checkStat', 'minimal');
    git(root, 'config', 'core.trustctime', 'false');
    const p = parkVia(home, root, 'lr-racy', oneFile);
    // b.ts racily clean: its cached mtime is the index's own second; then same-size new bytes, the mtime put back
    const b = path.join(root, 'src', 'b.ts');
    const m = Math.floor(fs.statSync(b).mtimeMs / 1000);
    git(root, 'update-index', '--refresh');
    fs.utimesSync(path.join(root, '.git', 'index'), m, m);
    fs.writeFileSync(b, 'export const b = 7;\n');
    fs.utimesSync(b, m, m);
    const st = (): string => git(root, '--no-optional-locks', 'status', '--porcelain').split('\n').filter((l) => l && !l.includes('HOOK-')).join('\n');
    expect(st()).toBe(' M src/b.ts');
    const r = await landCommit(input(root, p));
    expect(r.landed).toBe(true);
    expect(st()).toBe(' M src/b.ts');
  });
});

describe('M2: index shapes and the human\'s own git config', () => {
  it('a split index is refused; index v4 and the untracked cache are kept; the fsmonitor extension is dropped (status stays right)', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-x', oneFile);
    git(root, 'update-index', '--split-index');
    expect(refused(await landCommit(input(root, p)))).toEqual({ reason: 'attributes', waitable: false });
    git(root, 'update-index', '--no-split-index');
    git(root, 'update-index', '--index-version', '4');
    git(root, 'update-index', '--untracked-cache');
    git(root, '-c', 'core.untrackedCache=true', 'status');
    expect(fs.readFileSync(path.join(root, '.git', 'index')).includes('UNTR')).toBe(true);
    const fsm = path.join(tmp('gnomon-fsm-'), 'fsm.sh');
    fs.writeFileSync(fsm, "#!/bin/sh\nprintf 'tok\\0/\\0'\n", { mode: 0o755 });
    git(root, '-c', `core.fsmonitor=${fsm}`, '-c', 'core.fsmonitorHookVersion=2', 'status');
    expect(fs.readFileSync(path.join(root, '.git', 'index')).includes('FSMN')).toBe(true);
    const r = await landCommit(input(root, p));
    expect(r.landed).toBe(true);
    const idx = fs.readFileSync(path.join(root, '.git', 'index'));
    expect(idx.readUInt32BE(4)).toBe(4);
    expect(idx.includes('UNTR')).toBe(true);
    // DISPUTED (Aegis M2): keeping FSMN would mean running the repo's fsmonitor program; it is dropped and git rebuilds it
    expect(idx.includes('FSMN')).toBe(false);
    expect(git(root, 'rev-parse', 'HEAD^').trim()).toBe(base);
    expect(status(root)).toBe('');
  });

  it('the human\'s global attributesFile, XDG attributes, global autocrlf and an unreadable config each refuse', async () => {
    const { root } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-g', oneFile);
    const uh = tmp('gnomon-uh-');
    const userEnv = { HOME: uh, XDG_CONFIG_HOME: path.join(uh, '.config') };
    fs.writeFileSync(path.join(uh, 'attrs'), '*.ts filter=evil\n');
    fs.writeFileSync(path.join(uh, '.gitconfig'), `[core]\n\tattributesFile = ${path.join(uh, 'attrs')}\n`);
    expect(refused(await landCommit(input(root, p, { userEnv })))).toEqual({ reason: 'attributes', waitable: false });
    fs.writeFileSync(path.join(uh, '.gitconfig'), '[core]\n\tautocrlf = true\n');
    expect(refused(await landCommit(input(root, p, { userEnv })))).toEqual({ reason: 'attributes', waitable: false });
    fs.writeFileSync(path.join(uh, '.gitconfig'), '');
    fs.mkdirSync(path.join(uh, '.config', 'git'), { recursive: true });
    fs.writeFileSync(path.join(uh, '.config', 'git', 'attributes'), '*.ts eol=crlf\n');
    expect(refused(await landCommit(input(root, p, { userEnv })))).toEqual({ reason: 'attributes', waitable: false });
    fs.rmSync(path.join(uh, '.config', 'git', 'attributes'));
    fs.chmodSync(path.join(uh, '.gitconfig'), 0o000);
    const r = await landCommit(input(root, p, { userEnv }));
    fs.chmodSync(path.join(uh, '.gitconfig'), 0o644);
    expect(r).toMatchObject({ landed: false, reason: 'attributes', detail: expect.stringContaining('could not be read') });
    expect((await landCommit(input(root, p, { userEnv }))).landed).toBe(true);
  });
});

describe('Aegis lows on real git', () => {
  it('L1: a merge that starts between the fast check and the lock refuses; L5: the branch checked out in another worktree refuses', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const p = parkVia(home, root, 'lr-l', oneFile);
    const r = await landCommit(input(root, p, { step: (n) => n === 'locked' && fs.writeFileSync(path.join(root, '.git', 'MERGE_HEAD'), `${base}\n`) }));
    expect(refused(r)).toEqual({ reason: 'in-progress', waitable: true });
    fs.rmSync(path.join(root, '.git', 'MERGE_HEAD'));
    const wt = path.join(tmp('gnomon-wt-'), 'wt');
    git(root, 'worktree', 'add', '-q', '-f', wt, 'main');
    expect(await landCommit(input(root, p))).toMatchObject({ landed: false, reason: 'held', detail: expect.stringContaining('another worktree') });
    git(root, 'worktree', 'remove', '--force', wt);
    expect((await landCommit(input(root, p))).landed).toBe(true);
  });

  it('L3: an original written through an open handle after the move-aside is kept in recoverDir, never deleted', async () => {
    const { root } = repo();
    const home = tmp('gnomon-home-');
    const rec = tmp('gnomon-rec-');
    const p = parkVia(home, root, 'lr-rc', oneFile);
    const r = await landCommit(input(root, p, {
      recoverDir: rec,
      step: (n) => {
        if (n !== 'ref-moved') return;
        const bak = fs.readdirSync(path.join(root, 'src')).find((f) => f.endsWith('.bak'))!;
        fs.writeFileSync(path.join(root, 'src', bak), 'typed through an open editor buffer\n');
      },
    }));
    expect(r).toMatchObject({ landed: true, recovered: [path.join(rec, 'lr-1', 'src', 'a.ts')] });
    expect(fs.readFileSync(path.join(rec, 'lr-1', 'src', 'a.ts'), 'utf8')).toBe('typed through an open editor buffer\n');
    expect(fs.readdirSync(path.join(root, 'src')).filter((f) => f.startsWith('.gnomon-land-'))).toEqual([]);
  });
});

describe('M4: the boot reconcile of an interrupted land', () => {
  const lander = (home: string, root: string, rows: any[]) => {
    const out: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const toasts: string[] = [];
    const repoKey = 'rk';
    const l = new LoopLander({
      home, kernelPrincipal: 'k', append: async (kind, payload) => void out.push({ kind, payload }),
      registry: { entries: () => [{ repoKey, repoRoot: root }] as any, entry: () => null, canRun: () => ({ ok: true }) as any, trustOf: () => null, authoredBy: () => 'file' as any },
      effective: () => effectiveAutonomy({ autonomy: 'act' }, { level: 'L0', mode: 'auto-edits' }), isHeld: () => false, toast: (t) => toasts.push(t.text),
    });
    l.seed(rows.map((r) => ({ principal: 'k', at: new Date().toISOString(), ...r })));
    return { l, out, toasts };
  };

  it('a leftover private index marks it: the stale lock and the temps go (temps to recovered/), the row closes undone or done', async () => {
    const { root, base } = repo();
    const home = tmp('gnomon-home-');
    const gd = path.join(root, '.git');
    fs.writeFileSync(path.join(gd, 'gnomon-land-0123456789abcdef.index'), 'x');
    fs.writeFileSync(path.join(gd, 'index.lock'), '');
    const old = (Date.now() - 60_000) / 1000;
    fs.utimesSync(path.join(gd, 'index.lock'), old, old);
    fs.writeFileSync(path.join(root, 'src', '.gnomon-land-0123456789abcdef.bak'), 'the original\n');
    const landedRow = { kind: 'loop.landed', payload: { loopId: 'fixer', runId: 'lr-int', repoKey: 'rk', sha: 'e'.repeat(40), ref: 'refs/heads/main', paths: ['src/a.ts'], phase: 'intent' } };
    const a = lander(home, root, [landedRow]);
    expect(await a.l.reconcile()).toBe(1);
    expect(fs.existsSync(path.join(gd, 'index.lock'))).toBe(false);
    expect(fs.readdirSync(gd).filter((f) => f.startsWith('gnomon-land-'))).toEqual([]);
    expect(fs.readdirSync(path.join(root, 'src')).filter((f) => f.startsWith('.gnomon-land-'))).toEqual([]);
    expect(fs.readFileSync(path.join(home, 'loop-work', 'recovered', 'lr-int', 'src', '.gnomon-land-0123456789abcdef.bak'), 'utf8')).toBe('the original\n');
    expect(a.out.map((x) => [x.kind, x.payload.undone ?? x.payload.phase])).toEqual([['loop.land.waiting', true], ['loop.notified', undefined]]);
    expect(a.toasts[0]).toMatch(/interrupted by a restart and did not complete; check git status/);
    // the ref did move (tip == sha): it closes done; a lock held by live git (fresh mtime) is never removed
    fs.writeFileSync(path.join(gd, 'gnomon-land-0123456789abcdef.index'), 'x');
    fs.writeFileSync(path.join(gd, 'index.lock'), '');
    const b = lander(home, root, [{ ...landedRow, payload: { ...landedRow.payload, runId: 'lr-int2', sha: base } }]);
    expect(await b.l.reconcile()).toBe(1);
    expect(fs.existsSync(path.join(gd, 'index.lock'))).toBe(true);
    expect(b.out[0]).toMatchObject({ kind: 'loop.landed', payload: { phase: 'done', recovered: true } });
    // a completed land (intent + done) is left alone
    const c = lander(home, root, [landedRow, { kind: 'loop.landed', payload: { ...landedRow.payload, phase: 'done' } }]);
    expect(await c.l.reconcile()).toBe(0);
    fs.rmSync(path.join(gd, 'index.lock'));
  });
});

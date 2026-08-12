/**
 * warpignore.test — Warpline's NATIVE, git-independent ignore mechanism
 * (T-2026-08-12-002, founder correction TD-2026-08-12-218).
 *
 * The `.warpignore` file + handler govern what a WORKTREE snapshot (snapshotDir,
 * behind proposeNative/resolveNative) and the lens walk (behind absorb) skip —
 * with git ABSENT. Ignored paths never enter a tree, so they never become
 * symbols and never enter the fabric. Built-in defaults (.git/.warpline/
 * .warpline-judge/node_modules) hold even with no `.warpignore` present and
 * cannot be un-ignored by a stray `!` rule.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir } from '../src/warp/snapshot.js';
import { absorbTree } from '../src/fabric/native.js';
import { parseWarpignore, loadWarpignore, WARPIGNORE_DEFAULT_NAMES } from '../src/warp/warpignore.js';
import { type TreeEntry } from '../src/warp/tree.js';

/** All entry names under a tree, as `a/b/c` paths, sorted. */
function allPaths(store: ObjectStore, treeId: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of store.getTree(treeId) as TreeEntry[]) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    out.push(p);
    if (e.mode === '40000') out.push(...allPaths(store, e.id, p));
  }
  return out.sort();
}

describe('parseWarpignore — the pure gitignore-style matcher', () => {
  it('built-in defaults are ignored with no file, at any depth, un-negatably', () => {
    const m = parseWarpignore(null);
    for (const name of WARPIGNORE_DEFAULT_NAMES) {
      expect(m.isIgnored(name, true)).toBe(true);
      expect(m.isIgnored(`packages/a/${name}`, true)).toBe(true);
    }
    // (e) a stray negation CANNOT re-include a default.
    const neg = parseWarpignore('!.git\n!node_modules\n');
    expect(neg.isIgnored('.git', true)).toBe(true);
    expect(neg.isIgnored('node_modules', true)).toBe(true);
  });

  it('dir-only (`dist/`) matches directories only; `*.log` matches files at any depth', () => {
    const m = parseWarpignore('dist/\n*.log\n');
    expect(m.isIgnored('dist', true)).toBe(true);
    expect(m.isIgnored('dist', false)).toBe(false); // a FILE named dist is not dir-only-matched
    expect(m.isIgnored('debug.log', false)).toBe(true);
    expect(m.isIgnored('sub/nested.log', false)).toBe(true);
    expect(m.isIgnored('keep.txt', false)).toBe(false);
  });

  it('negation `!keep.log` re-includes (last match wins)', () => {
    const m = parseWarpignore('*.log\n!keep.log\n');
    expect(m.isIgnored('debug.log', false)).toBe(true);
    expect(m.isIgnored('keep.log', false)).toBe(false);
  });

  it('anchoring: leading `/` roots the pattern; a bare name matches any depth', () => {
    const anchored = parseWarpignore('/tmp.txt\n');
    expect(anchored.isIgnored('tmp.txt', false)).toBe(true);
    expect(anchored.isIgnored('sub/tmp.txt', false)).toBe(false);
    const floating = parseWarpignore('tmp.txt\n');
    expect(floating.isIgnored('tmp.txt', false)).toBe(true);
    expect(floating.isIgnored('sub/tmp.txt', false)).toBe(true);
  });

  it('globs: `**` crosses segments, `?` is one non-slash char', () => {
    const m = parseWarpignore('a/**/z.txt\nfile-?.bin\n');
    expect(m.isIgnored('a/z.txt', false)).toBe(true);
    expect(m.isIgnored('a/b/c/z.txt', false)).toBe(true);
    expect(m.isIgnored('file-1.bin', false)).toBe(true);
    expect(m.isIgnored('file-12.bin', false)).toBe(false);
  });

  it('comments and blank lines are skipped', () => {
    const m = parseWarpignore('# a comment\n\n   \n*.tmp\n');
    expect(m.isIgnored('x.tmp', false)).toBe(true);
    expect(m.isIgnored('x.txt', false)).toBe(false);
  });
});

describe('snapshotDir — `.warpignore` governs the worktree walk', () => {
  let root: string;
  let store: ObjectStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-warpignore-'));
    store = new ObjectStore(root);
    fs.writeFileSync(path.join(root, 'kept.txt'), 'kept\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(a) built-in defaults are excluded with NO `.warpignore` present', () => {
    // node_modules + .warpline-judge are the proof that the NATIVE handler is
    // wired: .warpline-judge is not in the legacy always-ignore set at all.
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'x\n');
    fs.mkdirSync(path.join(root, '.warpline-judge'), { recursive: true });
    fs.writeFileSync(path.join(root, '.warpline-judge', 'witness.head'), 'h\n');
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: x\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual(['kept.txt']);
    // .warpline-judge default is native-only — confirm loadWarpignore sees it.
    expect(loadWarpignore(root).isIgnored('.warpline-judge', true)).toBe(true);
  });

  it('(b) a `.warpignore` with `dist/` and `*.log` excludes matching paths from the lift', () => {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'b\n');
    fs.writeFileSync(path.join(root, 'debug.log'), 'd\n');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'nested.log'), 'n\n');
    fs.writeFileSync(path.join(root, 'sub', 'code.txt'), 'c\n');
    fs.writeFileSync(path.join(root, '.warpignore'), 'dist/\n*.log\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual([
      '.warpignore',
      'kept.txt',
      'sub',
      'sub/code.txt',
    ]);
  });

  it('(c) negation `!keep.log` re-includes a file the `*.log` rule excluded', () => {
    fs.writeFileSync(path.join(root, 'debug.log'), 'd\n');
    fs.writeFileSync(path.join(root, 'keep.log'), 'k\n');
    fs.writeFileSync(path.join(root, '.warpignore'), '*.log\n!keep.log\n');

    const snap = snapshotDir(store, root);
    const paths = allPaths(store, snap.treeId);
    expect(paths).toContain('keep.log');
    expect(paths).not.toContain('debug.log');
  });

  it('(e) defaults cannot be un-ignored by a stray `!.git` (safety)', () => {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: x\n');
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x\n');
    fs.writeFileSync(path.join(root, '.warpignore'), '!.git\n!node_modules\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual(['.warpignore', 'kept.txt']);
  });
});

describe('(d) THE DOGFOOD REGRESSION — a nested worktree in `.warpignore` is not absorbed', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-dogfood-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('`wt-bea/` listed in `.warpignore` yields no phantom files OR symbols when the root is snapshotted', async () => {
    // The real project (root) — a .purpose whose components become symbols.
    fs.writeFileSync(
      path.join(root, '.purpose'),
      'version: "2.0"\ndescription: Dogfood fixture\ncomponents:\n  alpha:\n    description: The real component\n    type: module\n',
      'utf8',
    );
    fs.writeFileSync(path.join(root, 'real.txt'), 'real\n');

    // `fork --into wt-bea` under the repo root, then a ROOT propose: without an
    // ignore, the nested worktree's config/.purpose is ABSORBED as phantom
    // `#cfg:wt-bea/...` symbols (the cold-agent footgun). `.warpignore` is the fix.
    fs.mkdirSync(path.join(root, 'wt-bea'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'wt-bea', '.purpose'),
      'version: "2.0"\ndescription: Nested worktree — must NOT be absorbed\ncomponents:\n  phantom:\n    description: A phantom that must never enter the fabric\n    type: module\n',
      'utf8',
    );
    fs.writeFileSync(path.join(root, 'wt-bea', 'package.json'), '{"phantomKey": true, "name": "wt-bea"}\n');
    fs.writeFileSync(path.join(root, 'wt-bea', 'nested.txt'), 'nested\n');

    fs.writeFileSync(path.join(root, '.warpignore'), 'wt-bea/\n');

    const store = new ObjectStore(root);
    const snap = snapshotDir(store, root);

    // 1) The nested worktree is absent from the sealed TREE.
    const paths = allPaths(store, snap.treeId);
    expect(paths).not.toContain('wt-bea');
    expect(paths.some((p) => p.startsWith('wt-bea/'))).toBe(false);
    expect(paths).toContain('.purpose');
    expect(paths).toContain('real.txt');

    // 2) The nested worktree is absent from the absorbed STATE — no phantom symbol.
    const state = await absorbTree(store, snap.treeId, 'refs/scratch/tester');
    const ids = [...state.objects.keys()];
    expect(ids.some((id) => id.includes('wt-bea'))).toBe(false);
    expect(ids.some((id) => id.includes('phantom'))).toBe(false);
    // sanity: the REAL component IS present (the fixture actually lifts symbols).
    expect(ids.some((id) => id.includes('alpha'))).toBe(true);
  });
});

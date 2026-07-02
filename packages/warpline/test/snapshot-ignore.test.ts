/**
 * snapshot-ignore.test — Move 2 item 3 (T-031 / HIGH-3, the dogfooding unblock).
 * The WORKTREE snapshot path honors ignore rules: .warplineignore (preferred) or
 * .gitignore (fallback) at the root, gitignore syntax (dir patterns, globs,
 * negation `!`, anchored `/`), plus ALWAYS-ignored .git/.warpline/node_modules at
 * any depth — so worktree pick/admit never ingests dependency trees or secrets
 * into the permanent no-gc object store. The REF snapshot path (git ls-tree) is
 * deliberately unaffected: git already governs what a ref contains.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ObjectStore } from '../src/warp/object-store.js';
import { blobId } from '../src/warp/blob.js';
import { snapshotDir, snapshotRef } from '../src/warp/snapshot.js';
import { recordPick } from '../src/fabric/pick.js';
import { type TreeEntry } from '../src/warp/tree.js';

const execFileAsync = promisify(execFile);

/** All entry names under a tree, as `a/b/c` paths. */
function allPaths(store: ObjectStore, treeId: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of store.getTree(treeId) as TreeEntry[]) {
    const p = prefix ? `${prefix}/${e.name}` : e.name;
    out.push(p);
    if (e.mode === '40000') out.push(...allPaths(store, e.id, p));
  }
  return out.sort();
}

describe('snapshotDir — worktree ignore semantics (T-031)', () => {
  let root: string;
  let store: ObjectStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-snap-ignore-'));
    store = new ObjectStore(root);
    fs.writeFileSync(path.join(root, 'kept.txt'), 'kept\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('node_modules + .env behind a .gitignore → objects NOT ingested into the store', () => {
    const SECRET = Buffer.from('API_KEY=hunter2\n');
    const DEP = Buffer.from('module.exports = 42;\n');
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), DEP);
    fs.writeFileSync(path.join(root, '.env'), SECRET);
    fs.writeFileSync(path.join(root, '.gitignore'), '.env\nnode_modules/\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual(['.gitignore', 'kept.txt']);
    // The strong claim: the BYTES never entered the permanent no-gc store.
    expect(store.has(blobId(SECRET))).toBe(false);
    expect(store.has(blobId(DEP))).toBe(false);
  });

  it('node_modules is ALWAYS ignored — even with no ignore file at all, at any depth', () => {
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x\n');
    fs.mkdirSync(path.join(root, 'packages', 'a', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'a', 'node_modules', 'y.js'), 'y\n');
    fs.writeFileSync(path.join(root, 'packages', 'a', 'src.txt'), 'src\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual(['kept.txt', 'packages', 'packages/a', 'packages/a/src.txt']);
  });

  it('gitignore syntax: globs, negation !, anchored / patterns', () => {
    fs.writeFileSync(path.join(root, 'debug.log'), 'd\n');
    fs.writeFileSync(path.join(root, 'keep.log'), 'k\n');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'nested.log'), 'n\n');
    fs.writeFileSync(path.join(root, 'sub', 'tmp.txt'), 't\n');
    fs.writeFileSync(path.join(root, 'tmp.txt'), 't\n');
    // *.log everywhere except keep.log; tmp.txt anchored to the ROOT only.
    fs.writeFileSync(path.join(root, '.gitignore'), '*.log\n!keep.log\n/tmp.txt\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual(['.gitignore', 'keep.log', 'kept.txt', 'sub', 'sub/tmp.txt']);
  });

  it('.warplineignore takes precedence over .gitignore (replaces, never merges)', () => {
    fs.writeFileSync(path.join(root, 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'b\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'a.txt\n');
    fs.writeFileSync(path.join(root, '.warplineignore'), 'b.txt\n');

    const snap = snapshotDir(store, root);
    const paths = allPaths(store, snap.treeId);
    expect(paths).toContain('a.txt'); // .gitignore's rule NOT applied
    expect(paths).not.toContain('b.txt'); // .warplineignore's rule applied
  });

  it('an ignored directory is PRUNED — no re-inclusion inside it (gitignore semantics)', () => {
    fs.mkdirSync(path.join(root, 'dist'));
    fs.writeFileSync(path.join(root, 'dist', 'bundle.js'), 'b\n');
    fs.writeFileSync(path.join(root, 'dist', 'keep.txt'), 'k\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'dist/\n!dist/keep.txt\n');

    const snap = snapshotDir(store, root);
    expect(allPaths(store, snap.treeId)).toEqual(['.gitignore', 'kept.txt']);
  });
});

describe('worktree pick — the sealed binding honors ignore rules end to end', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-pick-ignore-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a WORKTREE pick over a root with node_modules/.env binds a tree without them', async () => {
    fs.writeFileSync(
      path.join(root, '.purpose'),
      'version: "2.0"\ndescription: Ignore fixture\ncomponents:\n  alpha:\n    description: A\n    type: module\n',
      'utf8',
    );
    fs.mkdirSync(path.join(root, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'dep', 'index.js'), 'x\n');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1\n');
    fs.writeFileSync(path.join(root, '.gitignore'), '.env\n');

    const res = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: '2026-07-01T00:00:00.000Z' });
    const store = new ObjectStore(root);
    const paths = allPaths(store, res.strand!.binding!.treeId);
    expect(paths).not.toContain('node_modules');
    expect(paths).not.toContain('.env');
    expect(paths).toContain('.purpose');
  });
});

describe('snapshotRef — the hook path (--ref HEAD) is unaffected by ignore rules', () => {
  let root: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-ref-ignore-'));
    const git = async (...a: string[]): Promise<void> => {
      await execFileAsync('git', a, { cwd: root, encoding: 'utf8' });
    };
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 'i@warpline.test');
    await git('config', 'user.name', 'Warpline I');
    await git('config', 'commit.gpgsign', 'false');
    // A file that is TRACKED but also listed in .gitignore (tracked wins in git).
    fs.writeFileSync(path.join(root, 'tracked-but-listed.txt'), 'tracked\n');
    fs.writeFileSync(path.join(root, '.gitignore'), 'tracked-but-listed.txt\n');
    await git('add', '-A', '-f');
    await git('commit', '-q', '-m', 'seed');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a tracked file stays in the ref snapshot even when .gitignore lists it', async () => {
    const store = new ObjectStore(root);
    const treeId = await snapshotRef(store, 'HEAD', { cwd: root });
    const names = store.getTree(treeId).map((e) => e.name);
    expect(names).toContain('tracked-but-listed.txt'); // git governs the ref path
    // …while the WORKTREE path skips it (the asymmetry is the point: T-031 vs hook).
    const wt = snapshotDir(store, root);
    expect(store.getTree(wt.treeId).map((e) => e.name)).not.toContain('tracked-but-listed.txt');
  });
});

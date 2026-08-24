/**
 * branch-verbs.test — the M2.5 increment-2 verbs (#branch, TD-2026-08-12-813,
 * Arky's design): create / list / delete a named line, and SWITCH the worktree
 * between them.
 *
 * These exercise the verbs against REAL sealed strands with REAL byte bindings
 * (trees put into the native object store) so `switch` genuinely restores bytes —
 * no git. The verbs reuse the increment-1 foundation (#head symref, #fabric-refs
 * CAS, a branch-name #restore selector) and the shared guarded byte-writer, so the
 * tests assert the WIRING (create-at-tip, current marker, trunk/current refusals,
 * restore + HEAD move, refuse-dirty + --force) rather than re-deriving the algebra.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBranch,
  listBranches,
  deleteBranch,
  switchBranch,
} from '../src/fabric/branch.js';
import { readHead, DEFAULT_BRANCH } from '../src/fabric/head.js';
import { readRef, writeRef } from '../src/fabric/refs.js';
import { warplineDirOf, appendStrand } from '../src/fabric/fabric.js';
import { buildStrandV3, type Strand, type StrandV3Input } from '../src/fabric/strand.js';
import { ObjectStore } from '../src/warp/object-store.js';

const EMPTY_DELTA = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-branch-verbs-'));
}

/** Put a one-file tree {readme.md: body} (+ optional extra file) into the store → treeId. */
function putTree(root: string, readme: string, extra?: { name: string; body: string }): string {
  const store = new ObjectStore(root);
  const entries = [{ mode: '100644' as const, name: 'readme.md', id: store.putBlob(Buffer.from(readme)) }];
  if (extra) entries.push({ mode: '100644' as const, name: extra.name, id: store.putBlob(Buffer.from(extra.body)) });
  return store.putTree(entries);
}

/** Seal a v3 strand bound to `tree` and append it to the ledger; returns the strand. */
function seal(root: string, tree: string, over: Partial<StrandV3Input> = {}): Strand {
  const s = buildStrandV3({
    parents: [],
    stateId: 'state:v0:' + 'a',
    actor: 'tester',
    authoredBy: { agentId: null },
    intent: 'seal',
    recordedAt: '2026-08-12T00:00:00.000Z',
    objectCount: 1,
    delta: { ...EMPTY_DELTA },
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    binding: { treeId: tree, gitOid: null },
    ...over,
  });
  appendStrand(warplineDirOf(root), s);
  return s;
}

describe('branch — create / list / delete', () => {
  let root: string;
  let wdir: string;
  let trunk: Strand;

  beforeEach(() => {
    root = mkTmp();
    wdir = warplineDirOf(root);
    // a trunk tip on refs/heads/selvage (absent HEAD ≡ on selvage).
    const treeA = putTree(root, 'trunk\n');
    trunk = seal(root, treeA, { intent: 'trunk', stateId: 'state:v0:trunk' });
    writeRef(wdir, 'selvage', trunk.pickId);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('`branch <name>` creates a ref at HEAD tip; a duplicate refuses', () => {
    const r = createBranch(root, 'feature-x');
    expect(r.pickId).toBe(trunk.pickId); // pointed at the current HEAD (selvage) tip
    expect(r.from).toBe('HEAD');
    expect(readRef(wdir, 'feature-x')).toBe(trunk.pickId);

    // creating the SAME name again refuses (CAS-null / must-not-exist).
    expect(() => createBranch(root, 'feature-x')).toThrow(/already exists/);
    // an illegal name fails closed.
    expect(() => createBranch(root, '../escape')).toThrow(/illegal branch name/);
  });

  it('`--from <selector>` points the branch at that tip, not HEAD', () => {
    const treeB = putTree(root, 'feature\n');
    const other = seal(root, treeB, { intent: 'other', stateId: 'state:v0:other', parents: [trunk.pickId] });
    const r = createBranch(root, 'feature', { from: other.pickId });
    expect(r.pickId).toBe(other.pickId);
    expect(readRef(wdir, 'feature')).toBe(other.pickId);
  });

  it('`branch --list` shows branches with the current one (selvage) marked', () => {
    createBranch(root, 'feature-x');
    const list = listBranches(root);
    const names = list.map((b) => b.name);
    expect(names).toEqual(['feature-x', 'selvage']); // sorted by name
    const selvage = list.find((b) => b.name === 'selvage')!;
    const feature = list.find((b) => b.name === 'feature-x')!;
    expect(selvage.current).toBe(true); // absent HEAD ≡ on selvage
    expect(feature.current).toBe(false);
    expect(feature.pickId).toBe(trunk.pickId);
  });

  it('`branch -d` removes a non-current branch; refuses selvage and the current branch', () => {
    createBranch(root, 'feature-x');
    // delete a plain, non-current branch.
    const d = deleteBranch(root, 'feature-x');
    expect(d.pickId).toBe(trunk.pickId);
    expect(readRef(wdir, 'feature-x')).toBeNull(); // ref gone
    // the strand it named survives in the ledger (recoverable) — appendStrand never removes.
    expect(readRef(wdir, 'selvage')).toBe(trunk.pickId);

    // refuse deleting the trunk.
    expect(() => deleteBranch(root, 'selvage')).toThrow(/default trunk/);
    // refuse deleting a branch that does not exist.
    expect(() => deleteBranch(root, 'ghost')).toThrow(/no branch "ghost"/);

    // refuse deleting the CURRENT branch: switch onto feature2, then try to delete it.
    createBranch(root, 'feature2');
    switchBranch(root, root, 'feature2');
    expect(readHead(root)).toEqual({ kind: 'branch', branch: 'feature2' });
    expect(() => deleteBranch(root, 'feature2')).toThrow(/CURRENT branch/);
  });
});

describe('switch — restore the tip into the worktree + move HEAD', () => {
  let root: string;
  let wdir: string;

  beforeEach(() => {
    root = mkTmp();
    wdir = warplineDirOf(root);
    const treeA = putTree(root, 'trunk\n');
    const trunk = seal(root, treeA, { intent: 'trunk', stateId: 'state:v0:trunk' });
    writeRef(wdir, 'selvage', trunk.pickId);
    // a divergent 'feature' branch tip (different bytes) to prove restore writes them.
    const treeB = putTree(root, 'feature\n', { name: 'feature.txt', body: 'only on feature\n' });
    const featTip = seal(root, treeB, { intent: 'feature', stateId: 'state:v0:feat', parents: [trunk.pickId] });
    writeRef(wdir, 'feature', featTip.pickId);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('restores the branch tip bytes into the worktree and moves HEAD', () => {
    const r = switchBranch(root, root, 'feature');
    expect(r.branch).toBe('feature');
    expect(r.previous).toBe(DEFAULT_BRANCH); // absent HEAD was on selvage
    expect(readHead(root)).toEqual({ kind: 'branch', branch: 'feature' });
    // the tip bytes are in the worktree, git absent.
    expect(fs.readFileSync(path.join(root, 'readme.md'), 'utf8')).toBe('feature\n');
    expect(fs.readFileSync(path.join(root, 'feature.txt'), 'utf8')).toBe('only on feature\n');
  });

  it('a DIRTY worktree path (bytes in no object) refuses without --force, succeeds with it', () => {
    // a hand edit nothing has a copy of, colliding with a path the target tree writes.
    fs.writeFileSync(path.join(root, 'readme.md'), 'local edit nobody has a copy of\n');
    expect(() => switchBranch(root, root, 'feature')).toThrow(/refusing to overwrite/);
    // the refusal wrote nothing — the dirty bytes survive, HEAD did not move.
    expect(fs.readFileSync(path.join(root, 'readme.md'), 'utf8')).toBe('local edit nobody has a copy of\n');
    expect(readHead(root)).toBeNull(); // still absent (on selvage), never moved

    // --force overrides.
    const r = switchBranch(root, root, 'feature', { force: true });
    expect(r.branch).toBe('feature');
    expect(fs.readFileSync(path.join(root, 'readme.md'), 'utf8')).toBe('feature\n');
    expect(readHead(root)).toEqual({ kind: 'branch', branch: 'feature' });
  });

  it('switching to a non-existent branch refuses clearly', () => {
    expect(() => switchBranch(root, root, 'ghost')).toThrow(/no branch "ghost"/);
    expect(readHead(root)).toBeNull(); // untouched
  });
});

describe('branch × switch — the round trip', () => {
  it('create off selvage, switch to it (HEAD reads the new branch), switch back restores selvage', () => {
    const root = mkTmp();
    const wdir = warplineDirOf(root);
    try {
      const treeA = putTree(root, 'trunk\n');
      const trunk = seal(root, treeA, { intent: 'trunk', stateId: 'state:v0:trunk' });
      writeRef(wdir, 'selvage', trunk.pickId);

      // 1. create a branch off selvage (shares the trunk tip).
      createBranch(root, 'lane');
      expect(readRef(wdir, 'lane')).toBe(trunk.pickId);

      // 2. switch onto it — HEAD reads the new branch, worktree carries the tip.
      switchBranch(root, root, 'lane');
      expect(readHead(root)).toEqual({ kind: 'branch', branch: 'lane' });
      expect(fs.readFileSync(path.join(root, 'readme.md'), 'utf8')).toBe('trunk\n');
      // the current marker follows HEAD.
      expect(listBranches(root).find((b) => b.name === 'lane')!.current).toBe(true);

      // 3. switch back to selvage — HEAD returns, bytes restore (a no-op here: same tree).
      const back = switchBranch(root, root, 'selvage');
      expect(back.branch).toBe('selvage');
      expect(back.previous).toBe('lane');
      expect(readHead(root)).toEqual({ kind: 'branch', branch: 'selvage' });
      expect(fs.readFileSync(path.join(root, 'readme.md'), 'utf8')).toBe('trunk\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

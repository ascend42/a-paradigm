/**
 * branch-foundation.test — the M2.5 branching FOUNDATION primitives
 * (TD-2026-08-12-813, Arky's design): #head (the current-branch pointer),
 * #mergebase (the LCA + criss-cross fail-closed), and #restore select.ts
 * accepting a bare branch name as a selector.
 *
 * These are pure/deterministic building blocks — the tests exercise the algebra
 * (symref round-trips, the LCA on linear/divergent/criss-cross/disjoint shapes,
 * a branch-name selector) with no clock and no git.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readHead, writeHead, resolveHeadTip, DEFAULT_BRANCH } from '../src/fabric/head.js';
import { ancestorSet, mergeBase } from '../src/fabric/mergebase.js';
import { writeRef, readRef } from '../src/fabric/refs.js';
import { warplineDirOf, appendStrand } from '../src/fabric/fabric.js';
import { resolveSelector } from '../src/fabric/select.js';
import { buildStrandV3, type Strand, type StrandV3Input } from '../src/fabric/strand.js';

const P = (n: string): string => `pick:v2:${n.repeat(64)}`;

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-branch-'));
}

const T_A = 'tree:v1:' + 'a'.repeat(64);
const EMPTY_DELTA = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

/** A real v3 strand (pickId bound to parents/intent) — the mergeBase fixtures. */
function mk(over: Partial<StrandV3Input>): Strand {
  return buildStrandV3({
    parents: [],
    stateId: 'state:v0:abc',
    actor: 'tester',
    authoredBy: { agentId: null },
    intent: 'strand',
    recordedAt: '2026-08-12T00:00:00.000Z',
    objectCount: 1,
    delta: { ...EMPTY_DELTA },
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    binding: { treeId: T_A, gitOid: null },
    ...over,
  });
}

function byPickOf(strands: Strand[]): Map<string, Strand> {
  const m = new Map<string, Strand>();
  for (const s of strands) if (!m.has(s.pickId)) m.set(s.pickId, s);
  return m;
}

/* ─────────────────────────── #head ─────────────────────────── */

describe('head · the current-branch symref round-trips', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = mkTmp();
    wdir = warplineDirOf(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a branch symref round-trips', () => {
    expect(readHead(root)).toBeNull(); // absent
    writeHead(root, { kind: 'branch', branch: 'feature-x' });
    expect(readHead(root)).toEqual({ kind: 'branch', branch: 'feature-x' });
    // stored as git's `ref: refs/heads/<name>` form
    expect(fs.readFileSync(path.join(wdir, 'HEAD'), 'utf8').trim()).toBe('ref: refs/heads/feature-x');
  });

  it('a detached pickId round-trips', () => {
    writeHead(root, { kind: 'detached', pickId: P('c') });
    expect(readHead(root)).toEqual({ kind: 'detached', pickId: P('c') });
  });

  it('an ABSENT HEAD resolves to the selvage default; a branch symref follows the ref', () => {
    // absent → default branch (refs/heads/selvage); null tip until the ref exists
    expect(DEFAULT_BRANCH).toBe('selvage');
    expect(resolveHeadTip(root, wdir)).toBeNull();
    writeRef(wdir, 'selvage', P('1'));
    expect(resolveHeadTip(root, wdir)).toBe(P('1')); // absent HEAD → selvage tip

    // attach to a branch → follow that ref
    writeRef(wdir, 'feature-x', P('2'));
    writeHead(root, { kind: 'branch', branch: 'feature-x' });
    expect(resolveHeadTip(root, wdir)).toBe(P('2'));

    // an unborn branch (no ref yet) resolves to null, not an error
    writeHead(root, { kind: 'branch', branch: 'unborn' });
    expect(resolveHeadTip(root, wdir)).toBeNull();

    // detached → the pickId verbatim, no ref lookup
    writeHead(root, { kind: 'detached', pickId: P('9') });
    expect(resolveHeadTip(root, wdir)).toBe(P('9'));
  });

  it('rejects an illegal branch name (isRefName, fail closed) and refuses a corrupt HEAD', () => {
    for (const bad of ['../escape', 'a/b', '.hidden', '']) {
      expect(() => writeHead(root, { kind: 'branch', branch: bad })).toThrow(/illegal branch name/);
    }
    expect(() => writeHead(root, { kind: 'detached', pickId: 'state:v0:x' })).toThrow(/must be a pickId/);
    // a hand-corrupted HEAD is refused rather than read as absent
    fs.mkdirSync(wdir, { recursive: true });
    fs.writeFileSync(path.join(wdir, 'HEAD'), 'ref: refs/tags/v1\n');
    expect(() => readHead(root)).toThrow(/does not name a refs\/heads/);
    fs.writeFileSync(path.join(wdir, 'HEAD'), 'garbage\n');
    expect(() => readHead(root)).toThrow(/expected/);
  });
});

/* ─────────────────────────── #mergebase ─────────────────────────── */

describe('mergeBase · the lowest common ancestor', () => {
  it('ancestorSet is the inclusive parent-closure', () => {
    const G = mk({ intent: 'genesis' });
    const C1 = mk({ intent: 'c1', parents: [G.pickId] });
    const C2 = mk({ intent: 'c2', parents: [C1.pickId] });
    const byPick = byPickOf([G, C1, C2]);
    expect(ancestorSet(byPick, C2.pickId)).toEqual(new Set([C2.pickId, C1.pickId, G.pickId]));
    expect(ancestorSet(byPick, G.pickId)).toEqual(new Set([G.pickId]));
  });

  it('on a LINEAR chain the base is the fork point (the older of the two)', () => {
    const G = mk({ intent: 'genesis' });
    const C1 = mk({ intent: 'c1', parents: [G.pickId] });
    const C2 = mk({ intent: 'c2', parents: [C1.pickId] });
    const byPick = byPickOf([G, C1, C2]);
    // an ancestor × its descendant → the ancestor is the base
    expect(mergeBase(byPick, C2.pickId, C1.pickId)).toBe(C1.pickId);
    expect(mergeBase(byPick, C1.pickId, C2.pickId)).toBe(C1.pickId);
    // a node against itself → itself
    expect(mergeBase(byPick, C2.pickId, C2.pickId)).toBe(C2.pickId);
  });

  it('on two branches diverging from a common base returns that base', () => {
    const G = mk({ intent: 'genesis' });
    const A = mk({ intent: 'branch a', actor: 'alice', parents: [G.pickId] });
    const B = mk({ intent: 'branch b', actor: 'bob', parents: [G.pickId] });
    // extend each arm so the base is strictly below both tips
    const A2 = mk({ intent: 'a2', actor: 'alice', parents: [A.pickId] });
    const B2 = mk({ intent: 'b2', actor: 'bob', parents: [B.pickId] });
    const byPick = byPickOf([G, A, B, A2, B2]);
    expect(mergeBase(byPick, A2.pickId, B2.pickId)).toBe(G.pickId);
  });

  it('a CRISS-CROSS (two merge bases) returns {ambiguous}, deterministically ordered', () => {
    // G → A, B (concurrent) → M1 merges [A,B], M2 merges [B,A]. The common
    // ancestors of M1,M2 are {A,B,G}; A and B are both minimal → two merge bases.
    const G = mk({ intent: 'genesis' });
    const A = mk({ intent: 'a', actor: 'alice', parents: [G.pickId] });
    const B = mk({ intent: 'b', actor: 'bob', parents: [G.pickId] });
    const M1 = mk({
      intent: 'merge 1', parents: [A.pickId, B.pickId],
      merge: { algo: 'warpline-merge3-v1', base: T_A, ours: T_A, theirs: T_A, result: T_A },
    });
    const M2 = mk({
      intent: 'merge 2', parents: [B.pickId, A.pickId],
      merge: { algo: 'warpline-merge3-v1', base: T_A, ours: T_A, theirs: T_A, result: T_A },
    });
    const byPick = byPickOf([G, A, B, M1, M2]);
    const r = mergeBase(byPick, M1.pickId, M2.pickId);
    expect(typeof r).toBe('object');
    expect(r).not.toBeNull();
    const bases = (r as { ambiguous: string[] }).ambiguous;
    expect(new Set(bases)).toEqual(new Set([A.pickId, B.pickId]));
    // deterministic order — same set, same order regardless of arg order
    expect(mergeBase(byPick, M2.pickId, M1.pickId)).toEqual(r);
  });

  it('on DISJOINT roots returns null (no shared ancestor)', () => {
    const R1 = mk({ intent: 'root 1' });
    const C1 = mk({ intent: 'c1', parents: [R1.pickId] });
    const R2 = mk({ intent: 'root 2', actor: 'bob' });
    const C2 = mk({ intent: 'c2', actor: 'bob', parents: [R2.pickId] });
    const byPick = byPickOf([R1, C1, R2, C2]);
    expect(mergeBase(byPick, C1.pickId, C2.pickId)).toBeNull();
  });
});

/* ─────────────────────── select.ts · branch-name selector ─────────────────────── */

describe('resolveSelector · a bare branch name resolves to that ref tip', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = mkTmp();
    wdir = warplineDirOf(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('resolves a branch name to its tip strand + tree', () => {
    const tip = mk({ intent: 'feature tip' });
    appendStrand(wdir, tip);
    writeRef(wdir, 'feature-x', tip.pickId);

    const sel = resolveSelector(wdir, 'feature-x');
    expect(sel.strand!.pickId).toBe(tip.pickId);
    expect(sel.treeId).toBe(T_A);

    // an UNKNOWN branch name (no ref) still errors, not silently resolves
    expect(() => resolveSelector(wdir, 'does-not-exist')).toThrow(/unrecognized selector/);
    // the reserved forms are unshadowed: selvage still resolves via the tip branch
    writeRef(wdir, 'selvage', tip.pickId);
    expect(resolveSelector(wdir, 'selvage').strand!.pickId).toBe(tip.pickId);
  });
});

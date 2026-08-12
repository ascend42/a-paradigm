/**
 * branch-history.test — the M2.5 increment-6 multi-branch HISTORY surface (#graph,
 * TD-2026-08-12-813; closes M2 history-nav T-2026-07-01-013).
 *
 * READ-ONLY presentation over the layers increments 1–5 built: the derived pick-DAG
 * (#fabric-dag), the ref layer (#fabric-refs), HEAD (#head), and the native object
 * store. Nothing here seals, resolves, or moves a ref. The tests build REAL sealed
 * strands with REAL byte bindings (trees in the object store, git absent), then:
 *
 *   (a) `log`             — branchGraph annotates both branch tips with their names
 *                           and marks the current HEAD;
 *   (b) `log <branch>`    — ancestorsOf yields only that branch's ancestry line;
 *   (c) `diff A..B`       — diffTrees lists added / removed / modified paths;
 *   (d) `show <strand>`   — an ordinary strand renders its delta / intent / author,
 *                           not just KNOT payloads.
 *
 * The graph algebra is asserted at the LIBRARY level (deterministic, no build); the
 * CLI RENDERING of the same four surfaces is asserted end-to-end against the built
 * binary (guarded — skipped on a src-only checkout).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { branchGraph, ancestorsOf, diffTrees } from '../src/fabric/graph.js';
import { writeRef, listRefs } from '../src/fabric/refs.js';
import { readHead, writeHead } from '../src/fabric/head.js';
import { warplineDirOf, appendStrand, readFabric } from '../src/fabric/fabric.js';
import { buildStrandV3, type Strand, type StrandDelta, type StrandV3Input } from '../src/fabric/strand.js';
import { ObjectStore } from '../src/warp/object-store.js';

const execFileAsync = promisify(execFile);
const distCli = path.resolve(fileURLToPath(new URL('../dist/cli.js', import.meta.url)));
const haveDist = fs.existsSync(distCli);

const EMPTY_DELTA: StrandDelta = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-branch-history-'));
}

/** Put a tree of {name → body} into the object store → treeId. */
function putTree(root: string, files: Record<string, string>): string {
  const store = new ObjectStore(root);
  const entries = Object.entries(files)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, body]) => ({ mode: '100644' as const, name, id: store.putBlob(Buffer.from(body)) }));
  return store.putTree(entries);
}

/** Seal a v3 strand bound to `tree` and append it to the ledger; returns the strand. */
function seal(root: string, tree: string, over: Partial<StrandV3Input>): Strand {
  const s = buildStrandV3({
    parents: [],
    stateId: 'state:v0:default',
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

/**
 * A two-branch fabric off a shared genesis:
 *   G (genesis, a.txt)  ←  M (selvage tip, a.txt + s.txt)
 *                       ←  F (feature tip, a2.txt-edit + f.txt)
 * refs: selvage → M, feature → F. HEAD absent ≡ on selvage (the trunk).
 */
function twoBranches(root: string): { G: Strand; M: Strand; F: Strand; mTree: string; fTree: string } {
  const wdir = warplineDirOf(root);
  const gTree = putTree(root, { 'a.txt': 'a\n' });
  const G = seal(root, gTree, { intent: 'genesis', stateId: 'state:v0:g', recordedAt: '2026-08-12T00:00:00.000Z' });

  const fTree = putTree(root, { 'a.txt': 'a2\n', 'f.txt': 'feature\n' });
  const F = seal(root, fTree, {
    parents: [G.pickId],
    intent: 'add the feature',
    stateId: 'state:v0:f',
    recordedAt: '2026-08-12T00:00:01.000Z',
    authoredBy: { agentId: 'agent-42' },
    delta: { born: ['#feature-sym'], retired: [], contractChanged: [], renamedNoop: 0 },
  });

  const mTree = putTree(root, { 'a.txt': 'a\n', 's.txt': 'selvage\n' });
  const M = seal(root, mTree, {
    parents: [G.pickId],
    intent: 'trunk advance',
    stateId: 'state:v0:m',
    recordedAt: '2026-08-12T00:00:02.000Z',
  });

  writeRef(wdir, 'selvage', M.pickId);
  writeRef(wdir, 'feature', F.pickId);
  return { G, M, F, mTree, fTree };
}

describe('#graph — branchGraph (multi-branch log annotation)', () => {
  let root: string;
  beforeEach(() => (root = mkTmp()));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(a) annotates BOTH branch tips with their names and marks the current HEAD', () => {
    const { M, F } = twoBranches(root);
    const graph = branchGraph(readFabric(warplineDirOf(root)), listRefs(warplineDirOf(root)), readHead(root));

    // newest first: M (t=02), F (t=01), G (t=00).
    expect(graph.nodes.map((n) => n.strand.pickId).slice(0, 2)).toEqual([M.pickId, F.pickId]);

    const mNode = graph.nodes.find((n) => n.strand.pickId === M.pickId)!;
    const fNode = graph.nodes.find((n) => n.strand.pickId === F.pickId)!;

    // both tips carry their branch name in the decoration.
    expect(mNode.refs).toContain('selvage');
    expect(fNode.refs).toContain('feature');

    // HEAD is absent ≡ on the selvage trunk → the selvage tip is marked, feature is not.
    expect(mNode.head).toBe(true);
    expect(mNode.headBranch).toBe('selvage');
    expect(fNode.head).toBe(false);
  });

  it('(a) HEAD attached to the feature branch moves the * marker to the feature tip', () => {
    const { M, F } = twoBranches(root);
    writeHead(root, { kind: 'branch', branch: 'feature' });
    const graph = branchGraph(readFabric(warplineDirOf(root)), listRefs(warplineDirOf(root)), readHead(root));

    const mNode = graph.nodes.find((n) => n.strand.pickId === M.pickId)!;
    const fNode = graph.nodes.find((n) => n.strand.pickId === F.pickId)!;
    expect(fNode.head).toBe(true);
    expect(fNode.headBranch).toBe('feature');
    expect(mNode.head).toBe(false);
  });
});

describe('#graph — ancestorsOf (log <branch> ancestry line)', () => {
  let root: string;
  beforeEach(() => (root = mkTmp()));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(b) shows ONLY the branch tip and its ancestors, never the sibling branch', () => {
    const { G, M, F } = twoBranches(root);
    const fabric = readFabric(warplineDirOf(root));

    const featureLine = ancestorsOf(fabric, F.pickId).map((s) => s.pickId);
    expect(featureLine).toEqual([F.pickId, G.pickId]); // newest first, shared genesis included
    expect(featureLine).not.toContain(M.pickId); // the sibling trunk tip is NOT reachable

    const selvageLine = ancestorsOf(fabric, M.pickId).map((s) => s.pickId);
    expect(selvageLine).toEqual([M.pickId, G.pickId]);
    expect(selvageLine).not.toContain(F.pickId);
  });
});

describe('#graph — diffTrees (diff A..B byte diff between tips)', () => {
  let root: string;
  beforeEach(() => (root = mkTmp()));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(c) lists added / removed / modified paths between two branch tips', () => {
    const { mTree, fTree } = twoBranches(root);
    const store = new ObjectStore(root);

    // selvage (M) → feature (F): F adds f.txt, drops s.txt, edits a.txt.
    const td = diffTrees(store, mTree, fTree);
    expect(td.added).toEqual(['f.txt']); // only on F
    expect(td.removed).toEqual(['s.txt']); // only on M
    expect(td.modified).toEqual(['a.txt']); // present both, bytes moved

    // the reverse swaps added/removed; a self-diff is empty.
    const rev = diffTrees(store, fTree, mTree);
    expect(rev.added).toEqual(['s.txt']);
    expect(rev.removed).toEqual(['f.txt']);
    expect(rev.modified).toEqual(['a.txt']);
    expect(diffTrees(store, mTree, mTree)).toEqual({ added: [], removed: [], modified: [] });
  });
});

describe('#graph — show <ordinary-strand> carries delta / intent / author', () => {
  let root: string;
  beforeEach(() => (root = mkTmp()));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(d) an ordinary (non-KNOT) strand exposes its own delta, intent, author, and parents', () => {
    const { G, F } = twoBranches(root);
    // the feature tip is an ordinary pick — it carries a meaning delta, an intent,
    // an authoring agent, and its DAG parent, all readable without a KNOT payload.
    expect(F.delta.born).toEqual(['#feature-sym']);
    expect(F.intent).toBe('add the feature');
    expect(F.authoredBy?.agentId).toBe('agent-42');
    expect(F.parents).toEqual([G.pickId]);
    expect(F.resolves).toBeUndefined(); // NOT a KNOT resolution — the point of (d)
  });
});

/* ── CLI end-to-end: the rendered surfaces (guarded on the built binary) ──────── */

async function run(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [distCli, '--root', root, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

(haveDist ? describe : describe.skip)('#warpline-cli — multi-branch log / diff A..B / show <strand>', () => {
  let root: string;
  beforeEach(() => (root = mkTmp()));
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(a) `log` renders both tips annotated with their branch names + the HEAD marker', async () => {
    twoBranches(root);
    const r = await run(root, ['log']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('multi-branch');
    expect(r.stdout).toContain('feature'); // the feature tip decoration
    expect(r.stdout).toContain('selvage'); // the trunk tip decoration
    expect(r.stdout).toMatch(/HEAD -> selvage/); // absent HEAD ≡ selvage, marked
    expect(r.stdout).toContain('*'); // the current-HEAD marker column
  });

  it('(b) `log feature` renders only the feature ancestry line', async () => {
    twoBranches(root);
    const r = await run(root, ['log', 'feature']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ancestry');
    expect(r.stdout).toContain('add the feature'); // the feature tip intent
    expect(r.stdout).toContain('genesis'); // the shared ancestor
    expect(r.stdout).not.toContain('trunk advance'); // the sibling trunk tip is absent
  });

  it('(c) `diff selvage..feature` lists added / removed / modified paths', async () => {
    twoBranches(root);
    const r = await run(root, ['diff', 'selvage..feature']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('+ f.txt'); // added on feature
    expect(r.stdout).toContain('- s.txt'); // removed vs selvage
    expect(r.stdout).toContain('~ a.txt'); // modified
  });

  it('(d) `show feature` renders the strand delta / intent / author (not a KNOT)', async () => {
    twoBranches(root);
    const r = await run(root, ['show', 'feature']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('WARPLINE STRAND');
    expect(r.stdout).toContain('add the feature'); // intent, enveloped
    expect(r.stdout).toContain('agent-42'); // author
    expect(r.stdout).toMatch(/delta\s+\+1 born/); // its own meaning delta
  });
});

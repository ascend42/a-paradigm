/**
 * trust-floor.test — Move 2 item 1 (MEDIUM-1 + the OQ-D precondition). Verified
 * reads: ObjectStore.getBlob/getTree recompute the content-address of the bytes
 * they return and FAIL CLOSED on a mismatch — so restore aborts on a tampered
 * loose object instead of writing forged bytes. And `fabric verify` upgrades its
 * binding walk from presence to RECOMPUTE, plus validates the merge recipe
 * ({base,ours,theirs,result} exist + recompute; result === binding.treeId) — the
 * verify-side compensating control OQ-D committed to for the hash-excluded recipe.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { ObjectStore } from '../src/warp/object-store.js';
import { objectFrame, stripFrame } from '../src/warp/blob.js';
import { snapshotDir, snapshotRef, restoreTree } from '../src/warp/snapshot.js';
import { recordPick } from '../src/fabric/pick.js';
import { restore } from '../src/fabric/restore.js';
import { warplineDirOf, readFabric, appendStrand } from '../src/fabric/fabric.js';
import { computePickId, type Strand, type StrandBody, type MergeRecipe } from '../src/fabric/strand.js';
import { verifyFabric } from '../src/fabric/verify.js';

const execFileAsync = promisify(execFile);
const NOW = '2026-07-01T00:00:00.000Z';

/** The on-disk loose path of an object id (mirrors ObjectStore's fan-out layout). */
function loosePathOf(root: string, id: string): string {
  const kind = id.startsWith('tree:') ? 'trees' : 'blobs';
  const hex = id.slice(id.lastIndexOf(':') + 1);
  return path.join(root, '.warpline', 'objects', kind, hex.slice(0, 2), hex.slice(2));
}

/** Tamper a loose object IN PLACE: flip one body byte, keep the frame well-formed. */
function tamperLooseObject(root: string, id: string): void {
  const p = loosePathOf(root, id);
  const body = stripFrame(zlib.inflateSync(fs.readFileSync(p)));
  const tampered = Buffer.from(body);
  tampered[0] = tampered[0] ^ 0xff; // one flipped byte — same length, valid frame
  const kind = id.startsWith('tree:') ? 'tree' : 'blob';
  fs.writeFileSync(p, zlib.deflateSync(objectFrame(kind as 'blob' | 'tree', tampered)));
}

function writePurpose(root: string, components: string): void {
  fs.writeFileSync(
    path.join(root, '.purpose'),
    `version: "2.0"\ndescription: Trust-floor fixture\ncomponents:\n${components}`,
    'utf8',
  );
}

describe('ObjectStore — verified reads fail closed on tampered bytes', () => {
  let root: string;
  let store: ObjectStore;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-trust-store-'));
    store = new ObjectStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('getBlob recomputes the content-address and throws on a mismatch', () => {
    const id = store.putBlob(Buffer.from('the real bytes\n'));
    expect(store.getBlob(id).toString()).toBe('the real bytes\n'); // clean round-trip
    tamperLooseObject(root, id);
    expect(() => store.getBlob(id)).toThrow(/corruption.*fail closed/s);
  });

  it('getTree recomputes the content-address and throws on a mismatch', () => {
    const blob = store.putBlob(Buffer.from('x'));
    const id = store.putTree([{ mode: '100644', name: 'a.txt', id: blob }]);
    expect(store.getTree(id)).toHaveLength(1); // clean round-trip
    tamperLooseObject(root, id);
    expect(() => store.getTree(id)).toThrow(/corruption.*fail closed/s);
  });

  it('restoreTree fails closed (no partial forged tree) when a blob is tampered', () => {
    const dir = path.join(root, 'src-tree');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep\n');
    fs.writeFileSync(path.join(dir, 'victim.txt'), 'victim bytes\n');
    const snap = snapshotDir(store, dir);
    const victimBlob = store
      .getTree(snap.treeId)
      .find((e) => e.name === 'victim.txt')!.id;
    tamperLooseObject(root, victimBlob);
    const dest = path.join(root, 'restored');
    expect(() => restoreTree(store, snap.treeId, dest)).toThrow(/corruption/);
    expect(fs.existsSync(path.join(dest, 'victim.txt'))).toBe(false); // forged bytes never written
  });
});

describe('trust floor — a tampered loose object breaks restore AND is reported by fabric verify', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-trust-fabric-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('end to end over a sealed fabric (WORKTREE picks, no git)', async () => {
    writePurpose(root, '  alpha:\n    description: A\n    type: module\n');
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: NOW });
    writePurpose(root, '  alpha:\n    description: A\n    type: module\n  beta:\n    description: B\n    type: cli\n');
    await recordPick(root, { cwd: root, intent: 'add beta', actor: 'tester', now: NOW });

    const fabric = readFabric(warplineDirOf(root));
    const tip = fabric[fabric.length - 1];
    expect(verifyFabric(root).failures).toEqual([]); // clean before the tamper

    // Tamper the .purpose blob under the tip's binding tree.
    const store = new ObjectStore(root);
    const blob = store.getTree(tip.binding!.treeId).find((e) => e.mode === '100644')!.id;
    tamperLooseObject(root, blob);

    // restore fails closed…
    const dest = path.join(os.tmpdir(), 'warpline-trust-restore-dest-' + process.pid);
    try {
      expect(() => restore(root, { to: dest })).toThrow(/corruption/);
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    // …AND fabric verify reports the corrupt object (recompute, not presence).
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.kind === 'corrupt-object' && f.detail.includes(blob))).toBe(true);
  });
});

describe('fabric verify — merge-recipe validation (the OQ-D compensating control)', () => {
  let root: string;
  let store: ObjectStore;
  let genesis: Strand;
  let recipe: MergeRecipe;

  const strandOf = (body: StrandBody): Strand => ({ ...body, pickId: computePickId(body) });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-trust-merge-'));
    store = new ObjectStore(root);
    // Four small, distinct, PRESENT recipe trees.
    const tree = (text: string): string =>
      store.putTree([{ mode: '100644', name: 'f.txt', id: store.putBlob(Buffer.from(text)) }]);
    recipe = {
      algo: 'warpline-merge3-v1',
      base: tree('base\n'),
      ours: tree('ours\n'),
      theirs: tree('theirs\n'),
      result: tree('result\n'),
    };
    const genesisBody: StrandBody = {
      schemaVersion: 2,
      seq: 0,
      parentPickId: null,
      authoredBy: { agentId: 'arky' },
      stateId: 'state:v0:g',
      parentStateId: null,
      actor: 'tester',
      intent: 'genesis',
      recordedAt: NOW,
      objectCount: 1,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      binding: { treeId: recipe.base, gitOid: null },
    };
    genesis = strandOf(genesisBody);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function appendMerge(over: Partial<StrandBody> = {}): Strand {
    const body: StrandBody = {
      schemaVersion: 2,
      seq: 1,
      parentPickId: genesis.pickId,
      mergeParentPickId: genesis.pickId,
      authoredBy: { agentId: 'arky' },
      stateId: 'state:v0:m',
      parentStateId: genesis.stateId,
      actor: 'tester',
      intent: 'merge',
      recordedAt: NOW,
      objectCount: 1,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      merged: true,
      binding: { treeId: recipe.result, gitOid: null },
      merge: recipe,
      ...over,
    };
    const wdir = warplineDirOf(root);
    appendStrand(wdir, genesis);
    const merge = strandOf(body);
    appendStrand(wdir, merge);
    return merge;
  }

  it('a well-formed merge strand verifies (all four trees recompute, result == binding)', () => {
    appendMerge();
    expect(verifyFabric(root).failures).toEqual([]);
  });

  it('a MISSING recipe tree → merge-recipe-invalid', () => {
    const bogus = 'tree:v1:' + 'e'.repeat(64);
    appendMerge({ merge: { ...recipe, theirs: bogus } });
    const r = verifyFabric(root);
    // The recipe is EXCLUDED from the pickId (OQ-D) — so integrity passes and this
    // check is the only thing standing between a swapped recipe and a clean verify.
    expect(r.failures.some((f) => f.kind === 'pickId-mismatch')).toBe(false);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'merge-recipe-invalid' && f.detail.includes('theirs'))).toBe(true);
  });

  it('a TAMPERED recipe tree → merge-recipe-invalid', () => {
    appendMerge();
    tamperLooseObject(root, recipe.ours);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'merge-recipe-invalid' && f.detail.includes('ours'))).toBe(true);
  });

  it('merge.result != binding.treeId → merge-recipe-invalid', () => {
    appendMerge({ merge: { ...recipe, result: recipe.base } }); // recipe lands on other bytes
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'merge-recipe-invalid' && f.detail.includes('binding.treeId'))).toBe(true);
  });
});

describe('snapshotRef — T-033 root-ignore symmetry (.git/.warpline skipped on the ref path)', () => {
  let root: string;
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-trust-t033-'));
    const git = async (...a: string[]): Promise<void> => {
      await execFileAsync('git', a, { cwd: root, encoding: 'utf8' });
    };
    await git('init', '-q', '-b', 'main');
    await git('config', 'user.email', 't@warpline.test');
    await git('config', 'user.name', 'Warpline T');
    await git('config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'real.txt'), 'real\n');
    // A repo that TRACKS its own fabric ledger (this repo does) + a nested residue.
    fs.mkdirSync(path.join(root, '.warpline'), { recursive: true });
    fs.writeFileSync(path.join(root, '.warpline', 'fabric.jsonl'), '{}\n');
    fs.mkdirSync(path.join(root, 'sub', '.warpline'), { recursive: true });
    fs.writeFileSync(path.join(root, 'sub', '.warpline', 'x'), 'x\n');
    fs.writeFileSync(path.join(root, 'sub', 'kept.txt'), 'kept\n');
    await git('add', '-A', '-f');
    await git('commit', '-q', '-m', 'seed');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a tracked .warpline/ never enters a ref snapshot — and the tree is restorable', async () => {
    const store = new ObjectStore(root);
    const treeId = await snapshotRef(store, 'HEAD', { cwd: root });
    const names = store.getTree(treeId).map((e) => e.name).sort();
    expect(names).toEqual(['real.txt', 'sub']); // .warpline skipped at root…
    const sub = store.getTree(store.getTree(treeId).find((e) => e.name === 'sub')!.id);
    expect(sub.map((e) => e.name)).toEqual(['kept.txt']); // …and at any depth
    // The whole point: the bound tree is RESTORABLE (restoreTree forbids .warpline).
    const dest = path.join(root, 'restored');
    expect(() => restoreTree(store, treeId, dest)).not.toThrow();
    expect(fs.readFileSync(path.join(dest, 'sub', 'kept.txt'), 'utf8')).toBe('kept\n');
  });
});

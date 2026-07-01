/**
 * fabric-verify.test — the core authenticity suite (§6.2). `verifyFabric` recomputes
 * every strand's pickId (integrity), walks the v2 chain link (reorder/forge
 * detection), and re-derives each byte binding. A clean fabric verifies; a forged,
 * reordered, or bait-and-switched strand is caught; the v1 prefix self-hashes while
 * the v2 chain authenticates from the boundary forward.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { recordPick } from '../src/fabric/pick.js';
import { warplineDirOf, readFabric, appendStrand } from '../src/fabric/fabric.js';
import { computePickId, type Strand, type StrandBody } from '../src/fabric/strand.js';
import { verifyFabric } from '../src/fabric/verify.js';

const NOW = '2026-07-01T00:00:00.000Z';

function writePurpose(root: string, components: string): void {
  fs.writeFileSync(
    path.join(root, '.purpose'),
    `version: "2.0"\ndescription: Verify fixture\ncomponents:\n${components}`,
    'utf8',
  );
}

/** Seal a small 3-strand v2 fabric over a temp dir (no git needed for WORKTREE picks). */
async function sealV2Fabric(root: string): Promise<Strand[]> {
  writePurpose(root, '  alpha:\n    description: A\n    type: module\n');
  await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: NOW });
  writePurpose(root, '  alpha:\n    description: A\n    type: module\n  beta:\n    description: B\n    type: cli\n');
  await recordPick(root, { cwd: root, intent: 'add beta', actor: 'tester', agentId: 'arky', now: NOW });
  writePurpose(
    root,
    '  alpha:\n    description: A\n    type: module\n  beta:\n    description: B\n    type: cli\n  gamma:\n    description: G\n    type: module\n',
  );
  await recordPick(root, { cwd: root, intent: 'add gamma', actor: 'tester', now: NOW });
  return readFabric(warplineDirOf(root));
}

function rewriteRaw(root: string, strands: Strand[]): void {
  fs.writeFileSync(warplineDirOf(root) + '/fabric.jsonl', strands.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
}

describe('verifyFabric — a clean v2 fabric authenticates', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-verify-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('all strands v2, chain intact, bindings present → exit-equivalent 0', async () => {
    const fabric = await sealV2Fabric(root);
    expect(fabric.length).toBe(3);
    expect(fabric.every((s) => s.schemaVersion === 2)).toBe(true);
    const r = verifyFabric(root);
    expect(r.failures).toEqual([]);
    expect(r.v2Chain).toEqual({ count: 3, ok: true });
    expect(r.boundaryAnchored).toBe(true); // v2 genesis anchors null
    expect(r.legacyUnverifiable.count).toBe(0);
    // agentId flowed into the seq-1 strand; its pickId re-verifies (so agentId is IN it)
    expect(fabric[1].authoredBy?.agentId).toBe('arky');
    const { pickId, ...body } = fabric[1];
    expect(computePickId(body)).toBe(pickId);
  });
});

describe('verifyFabric — tamper detection', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-verify-tamper-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a forged interior strand (mutated intent) → pickId-mismatch', async () => {
    const fabric = await sealV2Fabric(root);
    fabric[1] = { ...fabric[1], intent: 'FORGED intent' }; // keep the stored pickId
    rewriteRaw(root, fabric);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'pickId-mismatch')).toBe(true);
  });

  it('a removed interior strand → chain-break (parentPickId no longer matches prev)', async () => {
    const fabric = await sealV2Fabric(root);
    const dropped = [fabric[0], fabric[2]]; // remove seq 1
    rewriteRaw(root, dropped);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.kind === 'chain-break')).toBe(true);
  });

  it('bait-and-switch to a DIFFERENT valid tree → pickId-mismatch (treeId is in the hash)', async () => {
    const fabric = await sealV2Fabric(root);
    const otherTree = fabric[2].binding!.treeId; // a valid, present tree
    fabric[1] = { ...fabric[1], binding: { ...fabric[1].binding!, treeId: otherTree } };
    rewriteRaw(root, fabric);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'pickId-mismatch')).toBe(true);
  });

  it('a self-consistent DANGLING binding (treeId repointed + pickId re-forged) → missing-binding', async () => {
    // The sophisticated forgery: repoint at a NON-present tree AND recompute the pickId
    // so step 1 passes — step 4 is the backstop that catches the dangling byte ref.
    const fabric = await sealV2Fabric(root);
    const bogus = 'tree:v1:' + 'd'.repeat(64);
    const tampered = { ...fabric[1], binding: { ...fabric[1].binding!, treeId: bogus } };
    const { pickId: _drop, ...body } = tampered;
    fabric[1] = { ...tampered, pickId: computePickId(body) }; // self-consistent
    rewriteRaw(root, fabric);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'pickId-mismatch')).toBe(false); // step 1 passes now
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'missing-binding')).toBe(true); // step 4 catches it
  });
});

describe('verifyFabric — a v1 prefix self-hashes; the v2 chain authenticates from the boundary', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-verify-prefix-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const v1 = (seq: number, over: Partial<StrandBody> = {}): Strand => {
    const body: StrandBody = {
      schemaVersion: 1,
      seq,
      stateId: `state:v0:v1seq${seq}`,
      parentStateId: seq === 0 ? null : `state:v0:v1seq${seq - 1}`,
      actor: 'ascend',
      intent: `v1 seq ${seq}`,
      recordedAt: NOW,
      objectCount: 10,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      ...over,
    };
    return { ...body, pickId: computePickId(body) };
  };

  it('14+1 shape: v1 prefix self-hashes, v2 chain ok, boundary anchored to the v1 tip', () => {
    const wdir = warplineDirOf(root);
    const s0 = v1(0);
    const s1 = v1(1);
    appendStrand(wdir, s0);
    appendStrand(wdir, s1);
    const v2body: StrandBody = {
      schemaVersion: 2,
      seq: 2,
      parentPickId: s1.pickId, // anchors the v1 tip
      authoredBy: { agentId: 'arky' },
      stateId: 'state:v0:v2seq2',
      parentStateId: s1.stateId,
      actor: 'ascend',
      intent: 'first v2 strand',
      recordedAt: NOW,
      objectCount: 12,
      delta: { born: ['#x'], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    };
    appendStrand(wdir, { ...v2body, pickId: computePickId(v2body) });

    const r = verifyFabric(root);
    expect(r.v1Prefix).toEqual({ count: 2, selfHashOk: true });
    expect(r.v2Chain).toEqual({ count: 1, ok: true });
    expect(r.boundaryAnchored).toBe(true);
    expect(r.failures).toEqual([]);

    // Corrupt the v1 genesis → v1 self-hash failure surfaced, but the chain still
    // reports the boundary (v1 tamper is per-strand, the v2 chain is independent).
    const fabric = readFabric(wdir);
    fabric[0] = { ...fabric[0], intent: 'CORRUPTED v1' };
    rewriteRaw(root, fabric);
    const r2 = verifyFabric(root);
    expect(r2.v1Prefix.selfHashOk).toBe(false);
    expect(r2.failures.some((f) => f.seq === 0 && f.kind === 'pickId-mismatch')).toBe(true);
    expect(r2.v2Chain.ok).toBe(true);
    expect(r2.boundaryAnchored).toBe(true);
  });
});

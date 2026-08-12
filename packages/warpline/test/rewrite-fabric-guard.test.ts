/**
 * rewrite-fabric-guard.test — the §4.4 / §7.4 identity guard. rewriteFabric refuses
 * to persist a strand whose stored pickId no longer reproduces under a known rule
 * AND is not grandfathered — so grade can move calibratedConfidence (excluded from
 * the hash) but can never silently drift an identity field. A grandfathered
 * (graded-over) strand passes so `grade` still runs over the real fabric.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { warplineDirOf, appendStrand, readFabric, rewriteFabric } from '../src/fabric/fabric.js';
import { gradeFabric, applyGrades } from '../src/fabric/grade.js';
import { computePickId, type Strand, type StrandBody } from '../src/fabric/strand.js';

const NOW = '2026-07-01T00:00:00.000Z';

function v2(seq: number, over: Partial<StrandBody> = {}): Strand {
  const body: StrandBody = {
    schemaVersion: 2,
    seq,
    parentPickId: seq === 0 ? null : `pick:v2:prev${seq}`,
    authoredBy: { agentId: 'arky' },
    stateId: `state:v0:seq${seq}`,
    parentStateId: seq === 0 ? null : `state:v0:seq${seq - 1}`,
    actor: 'ascend',
    intent: `seq ${seq}`,
    recordedAt: NOW,
    objectCount: 10,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    ...over,
  };
  return { ...body, pickId: computePickId(body) };
}

describe('rewriteFabric guard — grade round-trips without moving identity', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-guard-'));
    const wdir = warplineDirOf(root);
    // 0 genesis; 1 pick(#a); 2 pick(#b); 3 pick(#c) — enough later strands to grade #a survived.
    // Grading is now DAG-REACHABILITY-scoped (TD-2026-08-12-813), so the chain must
    // carry REAL parentPickId links: the default `pick:v2:prev${seq}` parents dangle
    // (no matching strand), which under reachability yields zero descendants → #a
    // would grade PENDING, not survived. Thread the actual previous pickId so the
    // linear chain is a real DAG line and seq1's #a holds across seq2/seq3.
    const s0 = v2(0);
    const s1 = v2(1, { parentPickId: s0.pickId, parentStateId: s0.stateId, delta: { born: ['#a'], retired: [], contractChanged: [], renamedNoop: 0 }, calibratedConfidence: 0.7 });
    const s2 = v2(2, { parentPickId: s1.pickId, parentStateId: s1.stateId, delta: { born: ['#b'], retired: [], contractChanged: [], renamedNoop: 0 } });
    const s3 = v2(3, { parentPickId: s2.pickId, parentStateId: s2.stateId, delta: { born: ['#c'], retired: [], contractChanged: [], renamedNoop: 0 } });
    for (const s of [s0, s1, s2, s3]) appendStrand(wdir, s);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('applyGrades over a v2 fabric SUCCEEDS, pickIds unchanged, calibratedConfidence updated', async () => {
    const before = readFabric(warplineDirOf(root));
    const pickIdsBefore = before.map((s) => s.pickId);
    const report = gradeFabric(root, { window: 2 });
    await expect(applyGrades(root, report, NOW)).resolves.toBeUndefined(); // guard does NOT throw
    const after = readFabric(warplineDirOf(root));
    expect(after.map((s) => s.pickId)).toEqual(pickIdsBefore); // identity untouched
    // seq 1's #a held across ≥2 later strands → confidence raised (0.7 → 0.8)
    expect(after.find((s) => s.seq === 1)!.calibratedConfidence).toBe(0.8);
  });
});

describe('rewriteFabric guard — an identity mutation THROWS with the seq', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-guard-throw-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('mutating delta / stateId / binding.treeId / parentPickId (keeping pickId) throws', () => {
    const wdir = warplineDirOf(root);
    const good = v2(5, { binding: { treeId: 'tree:v1:aaa', gitOid: null } });
    appendStrand(wdir, good);

    const mutate = (over: Partial<Strand>): Strand[] => [{ ...good, ...over }]; // stored pickId kept
    for (const over of [
      { delta: { born: ['#hacked'], retired: [], contractChanged: [], renamedNoop: 0 } } as Partial<Strand>,
      { stateId: 'state:v0:swapped' } as Partial<Strand>,
      { binding: { treeId: 'tree:v1:swapped', gitOid: null } } as Partial<Strand>,
      { parentPickId: 'pick:v2:injected' } as Partial<Strand>,
    ]) {
      expect(() => rewriteFabric(wdir, mutate(over))).toThrowError(/rewriteFabric refused — strand seq 5/);
    }
  });
});

describe('rewriteFabric guard — a v1 binding stamp passes and does not move the pick:v0 id', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-guard-v1bind-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('stamping binding onto a v1 strand via rewriteFabric does not throw', () => {
    const wdir = warplineDirOf(root);
    const v1body: StrandBody = {
      schemaVersion: 1,
      seq: 0,
      stateId: 'state:v0:v1genesis',
      parentStateId: null,
      actor: 'ascend',
      intent: 'v1 genesis',
      recordedAt: NOW,
      objectCount: 5,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    };
    const v1 = { ...v1body, pickId: computePickId(v1body) };
    appendStrand(wdir, v1);
    // Backfill a binding — excluded from the v1 rule, so the pickId must not move.
    const stamped: Strand = { ...v1, binding: { treeId: 'tree:v1:backfilled', gitOid: 'deadbeef' } };
    expect(() => rewriteFabric(wdir, [stamped])).not.toThrow();
    expect(readFabric(wdir)[0].pickId).toBe(v1.pickId);
    expect(readFabric(wdir)[0].binding?.treeId).toBe('tree:v1:backfilled');
  });
});

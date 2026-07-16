/**
 * fabric-dag.test — the derived DAG index (V3.1, v3-identity spec §1.2 + §4).
 *
 * THE determinism proof (acceptance bar c): the same strand SET, arriving in
 * different orders on different machines, produces the SAME pickIds and the SAME
 * derived topological order — position is derived, never stored, so exchange
 * needs no re-identification. Ties between concurrent strands break by
 * (recordedAt, pickId) ascending.
 */

import { describe, it, expect } from 'vitest';
import { buildDag, parentsOf } from '../src/fabric/dag.js';
import { buildStrandV3, type Strand, type StrandV3Input } from '../src/fabric/strand.js';

const T_A = 'tree:v1:' + 'a'.repeat(64);
const T_R = 'tree:v1:' + 'e'.repeat(64);
const EMPTY_DELTA = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

function mk(over: Partial<StrandV3Input>): Strand {
  return buildStrandV3({
    parents: [],
    stateId: 'state:v0:abc',
    actor: 'tester',
    authoredBy: { agentId: null },
    intent: 'strand',
    recordedAt: '2026-07-16T00:00:00.000Z',
    objectCount: 1,
    delta: { ...EMPTY_DELTA },
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    binding: { treeId: T_A, gitOid: null },
    ...over,
  });
}

/** genesis → two CONCURRENT children (A, B) → a 2-parent weave W. */
function diamond(): { G: Strand; A: Strand; B: Strand; W: Strand } {
  const G = mk({ intent: 'genesis', recordedAt: '2026-07-16T00:00:00.000Z' });
  const A = mk({ intent: 'agent A', actor: 'alice', parents: [G.pickId], recordedAt: '2026-07-16T00:01:00.000Z' });
  const B = mk({ intent: 'agent B', actor: 'bob', parents: [G.pickId], recordedAt: '2026-07-16T00:02:00.000Z' });
  const W = mk({
    intent: 'weave A+B',
    parents: [A.pickId, B.pickId],
    recordedAt: '2026-07-16T00:03:00.000Z',
    merge: { algo: 'warpline-merge3-v1', base: T_A, ours: T_A, theirs: T_A, result: T_R },
    binding: { treeId: T_R, gitOid: null },
  });
  return { G, A, B, W };
}

describe('buildDag · derived order is deterministic across arrival orders', () => {
  it('two machines with different arrival orders derive the SAME order + positions', () => {
    const { G, A, B, W } = diamond();
    const machine1 = buildDag([G, A, B, W]); // A arrived before B
    const machine2 = buildDag([G, B, A, W]); // B arrived before A (concurrent race)
    const ids = (o: Strand[]): string[] => o.map((s) => s.pickId);
    expect(ids(machine1.order)).toEqual(ids(machine2.order));
    expect(machine1.positionOf).toEqual(machine2.positionOf);
    // and the derived order is causally sane: G first, W last
    expect(machine1.order[0].pickId).toBe(G.pickId);
    expect(machine1.order[3].pickId).toBe(W.pickId);
    // concurrent A/B tie-break by recordedAt: A (00:01) before B (00:02)
    expect(ids(machine1.order)).toEqual([G.pickId, A.pickId, B.pickId, W.pickId]);
  });

  it('EQUAL recordedAt ties break by pickId ascending (fully deterministic)', () => {
    const G = mk({ intent: 'genesis' });
    const NOW = '2026-07-16T00:05:00.000Z';
    const A = mk({ intent: 'concurrent 1', actor: 'alice', parents: [G.pickId], recordedAt: NOW });
    const B = mk({ intent: 'concurrent 2', actor: 'bob', parents: [G.pickId], recordedAt: NOW });
    const [first, second] = [A, B].sort((x, y) => (x.pickId < y.pickId ? -1 : 1));
    expect(buildDag([G, A, B]).order.map((s) => s.pickId)).toEqual([G.pickId, first.pickId, second.pickId]);
    expect(buildDag([G, B, A]).order.map((s) => s.pickId)).toEqual([G.pickId, first.pickId, second.pickId]);
  });

  it('appending the same strand twice dedups to one node (§1.3 idempotence)', () => {
    const { G, A } = diamond();
    const dag = buildDag([G, A, A]);
    expect(dag.order).toHaveLength(2);
    expect(dag.byPickId.size).toBe(2);
  });
});

describe('buildDag · index shape (heads / roots / children / closure)', () => {
  it('exposes heads, roots and children correctly on the diamond', () => {
    const { G, A, B, W } = diamond();
    const dag = buildDag([G, A, B, W]);
    expect(dag.roots.map((s) => s.pickId)).toEqual([G.pickId]);
    expect(dag.heads.map((s) => s.pickId)).toEqual([W.pickId]);
    expect(dag.children.get(G.pickId)).toEqual([A.pickId, B.pickId]);
    expect(dag.children.get(A.pickId)).toEqual([W.pickId]);
    expect(dag.children.get(B.pickId)).toEqual([W.pickId]);
    expect(dag.missingParents.size).toBe(0);
    expect(dag.cycle).toEqual([]);
  });

  it('records missing parents (closure holes) without losing the orderable remainder', () => {
    const { G, A } = diamond();
    const orphan = mk({ intent: 'orphan', parents: ['pick:v3:' + 'f'.repeat(64)], recordedAt: '2026-07-16T00:09:00.000Z' });
    const dag = buildDag([G, A, orphan]);
    expect(dag.missingParents.get(orphan.pickId)).toEqual(['pick:v3:' + 'f'.repeat(64)]);
    expect(dag.order).toHaveLength(3); // still ordered (verify makes the hole HARD, not the index)
  });

  it('detects a (forged) parent cycle — unorderable strands land in `cycle`', () => {
    // A cycle is impossible under honest hashing (a pickId embeds its parents), so
    // forge two strands whose stored ids point at each other.
    const base = mk({ intent: 'x' });
    const idX = 'pick:v3:' + '9'.repeat(64);
    const idY = 'pick:v3:' + '8'.repeat(64);
    const x: Strand = { ...base, pickId: idX, parents: [idY] };
    const y: Strand = { ...base, pickId: idY, parents: [idX] };
    const dag = buildDag([x, y]);
    expect(dag.order).toEqual([]);
    expect(new Set(dag.cycle)).toEqual(new Set([idX, idY]));
  });
});

describe('parentsOf · unifies the three epochs', () => {
  it('v3 → parents[]; v2 → [parentPickId, mergeParentPickId]; v1 → []', () => {
    const { W } = diamond();
    expect(parentsOf(W)).toEqual(W.parents);
    const v2: Strand = {
      schemaVersion: 2, seq: 3, pickId: 'pick:v2:' + '1'.repeat(64),
      parentPickId: 'pick:v2:' + '2'.repeat(64), mergeParentPickId: 'pick:v2:' + '3'.repeat(64),
      stateId: 'state:v0:s', parentStateId: 'state:v0:p', actor: 'a', intent: 'i',
      recordedAt: '2026-07-16T00:00:00.000Z', objectCount: 1, delta: { ...EMPTY_DELTA },
      calibratedConfidence: null, provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    };
    expect(parentsOf(v2)).toEqual(['pick:v2:' + '2'.repeat(64), 'pick:v2:' + '3'.repeat(64)]);
    expect(parentsOf({ ...v2, mergeParentPickId: null })).toEqual(['pick:v2:' + '2'.repeat(64)]);
    const v1: Strand = { ...v2, schemaVersion: 1, parentPickId: undefined, mergeParentPickId: undefined };
    expect(parentsOf(v1)).toEqual([]);
  });
});

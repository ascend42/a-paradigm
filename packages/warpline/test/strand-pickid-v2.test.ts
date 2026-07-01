/**
 * strand-pickid-v2.test — the schema-v2 pickId identity contract (§1, §6.1).
 *
 * v2 folds the chain link (parentPickId), the byte binding (binding.treeId), agent
 * attribution (authoredBy.agentId), and — on a merge — the second parent + algo INTO
 * the content-address (A1/Judge). Excluded (mutable/derivable post-seal):
 * calibratedConfidence, binding.gitOid, authoredBy.sessionKey, merge.{base,ours,theirs}.
 * The v1 (pick:v0) rule is byte-for-byte UNCHANGED so every historical strand still
 * re-verifies — proven here against a REAL strand from .warpline/fabric.jsonl.
 */

import { describe, it, expect } from 'vitest';
import { computePickId, type StrandBody, type MergeRecipe } from '../src/fabric/strand.js';

const V2_NOW = '2026-07-01T18:00:00.000Z';

function v2Body(over: Partial<StrandBody> = {}): StrandBody {
  return {
    schemaVersion: 2,
    seq: 15,
    parentPickId: 'pick:v2:prevstrand',
    authoredBy: { agentId: 'arky', sessionKey: 'sess-1' },
    stateId: 'state:v0:this',
    parentStateId: 'state:v0:prev',
    actor: 'ascend',
    intent: 'add #payment-form',
    recordedAt: V2_NOW,
    objectCount: 5176,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'HEAD', treeSha: 'deadbeef', gitCommit: 'cafef00d' },
    binding: { treeId: 'tree:v1:root', gitOid: 'deadbeef' },
    ...over,
  };
}

const RECIPE: MergeRecipe = {
  algo: 'warpline-merge3-v1',
  base: 'tree:v1:b',
  ours: 'tree:v1:o',
  theirs: 'tree:v1:t',
  result: 'tree:v1:result',
};

function v2Merge(over: Partial<StrandBody> = {}): StrandBody {
  return v2Body({
    merged: true,
    mergeParentPickId: 'pick:v2:base',
    binding: { treeId: 'tree:v1:result', gitOid: null }, // == recipe.result (folded IN as bindingTreeId)
    merge: RECIPE,
    ...over,
  });
}

describe('computePickId v2 — excluded fields never move the id', () => {
  it('calibratedConfidence, binding.gitOid, authoredBy.sessionKey are EXCLUDED', () => {
    const bare = computePickId(v2Body());
    expect(computePickId(v2Body({ calibratedConfidence: 0.9 }))).toBe(bare);
    expect(computePickId(v2Body({ binding: { treeId: 'tree:v1:root', gitOid: 'OTHER-OID' } }))).toBe(bare);
    expect(computePickId(v2Body({ authoredBy: { agentId: 'arky', sessionKey: 'a-different-session' } }))).toBe(bare);
    // sessionKey absent vs present (same agentId) is identical
    expect(computePickId(v2Body({ authoredBy: { agentId: 'arky' } }))).toBe(bare);
  });

  it('mints a pick:v2: address', () => {
    expect(computePickId(v2Body()).startsWith('pick:v2:')).toBe(true);
  });
});

describe('computePickId v2 — the A1 properties (binding + attribution are IN)', () => {
  it('swapping binding.treeId CHANGES the id (bait-and-switch is caught)', () => {
    const bare = computePickId(v2Body());
    expect(computePickId(v2Body({ binding: { treeId: 'tree:v1:DIFFERENT', gitOid: 'deadbeef' } }))).not.toBe(bare);
  });

  it('changing authoredBy.agentId CHANGES the id (attribution is identity)', () => {
    const bare = computePickId(v2Body());
    expect(computePickId(v2Body({ authoredBy: { agentId: 'loid', sessionKey: 'sess-1' } }))).not.toBe(bare);
    expect(computePickId(v2Body({ authoredBy: { agentId: null } }))).not.toBe(bare);
  });

  it('changing parentPickId CHANGES the id (the chain link)', () => {
    const bare = computePickId(v2Body());
    expect(computePickId(v2Body({ parentPickId: 'pick:v2:someoneelse' }))).not.toBe(bare);
  });
});

describe('computePickId v2 — genesis + null normalization', () => {
  it('null parentPickId/parentStateId hash deterministically', () => {
    const g = (over: Partial<StrandBody> = {}): StrandBody =>
      v2Body({ seq: 0, parentPickId: null, parentStateId: null, authoredBy: { agentId: null }, ...over });
    // two genesis bodies with identical content collide (deterministic); a distinct one does not
    expect(computePickId(g())).toBe(computePickId(g()));
    expect(computePickId(g({ intent: 'other genesis' }))).not.toBe(computePickId(g()));
  });
});

describe('computePickId v2 — merge identity', () => {
  it('mergeParentPickId and merge.algo are IN; merge.base/ours/theirs are OUT', () => {
    const bare = computePickId(v2Merge());
    // second parent is identity
    expect(computePickId(v2Merge({ mergeParentPickId: 'pick:v2:otherbase' }))).not.toBe(bare);
    // the algo tag is identity (Judge)
    const otherAlgo = { ...RECIPE, algo: 'warpline-merge3-v2' } as unknown as MergeRecipe;
    expect(computePickId(v2Merge({ merge: otherAlgo }))).not.toBe(bare);
    // the three parent byte-trees are re-derivation inputs, NOT identity
    expect(computePickId(v2Merge({ merge: { ...RECIPE, base: 'tree:v1:zzz', ours: 'tree:v1:yyy', theirs: 'tree:v1:xxx' } }))).toBe(bare);
  });
});

describe('computePickId v1 legacy recompute — the make-or-break regression (§6.1)', () => {
  it('reproduces a REAL current-rule stored pick:v0 from .warpline/fabric.jsonl byte-for-byte', () => {
    // seq 8 of THIS repo's dogfood fabric — sealed under the CURRENT exclusion rule
    // (§7.1 rule 2), the one the v1 legacy path in computePickId implements. If this
    // drifts, every current-rule historical strand fails `fabric verify` — stop and
    // report. (seq 0 uses the retired whole-body rule → covered by verifyFabric's
    // known-rule fallback + fabric-legacy.test.ts, not by this direct-recompute test.)
    const body: StrandBody = {
      schemaVersion: 1,
      seq: 8,
      stateId: 'state:v0:d3873b2d74259facebebe468915546f34d1a6691582d4e8b5d97c280a7c92f1e',
      parentStateId: 'state:v0:94fe650a803840a47b88e8a5a7532ca8cf0749382d9fd13da6a9b4dc6b444b77',
      actor: 'ascend <ascendinfinitely@gmail.com>',
      intent: 'feat(#grade): the calibration grader — confidence vs real outcome (the moat, live)',
      recordedAt: '2026-06-27T05:14:54.910Z',
      objectCount: 5263,
      delta: {
        born: [
          '#code:packages/warpline/src/cli.ts::printGrade',
          '#code:packages/warpline/src/fabric/fabric.ts::appendGradeEvent',
          '#code:packages/warpline/src/fabric/fabric.ts::rewriteFabric',
          '#code:packages/warpline/src/fabric/grade.ts::applyGrades',
          '#code:packages/warpline/src/fabric/grade.ts::gradeFabric',
          '#code:packages/warpline/src/fabric/grade.ts::priorClassOf',
          '#code:packages/warpline/src/fabric/grade.ts::round2',
          '#code:packages/warpline/test/grade.test.ts::strand',
          '#fabric-lock.',
          '#grade',
        ],
        retired: [],
        contractChanged: [
          '#code:packages/warpline/src/fabric/strand.ts::computePickId',
          '#warpline-cli',
        ],
        renamedNoop: 0,
      },
      calibratedConfidence: null,
      provenance: {
        ref: 'HEAD',
        treeSha: 'd998aa9213b346219219aece517cdcb8280798e7',
        gitCommit: '0e3d3d5710fddf37350b678239ef9a3f05668ebb',
      },
    };
    expect(computePickId(body)).toBe(
      'pick:v0:27b7dfec27a3496b64aceaa0283794e9c613e7b8a9235f1d53842c9d7971ef2b',
    );
  });
});

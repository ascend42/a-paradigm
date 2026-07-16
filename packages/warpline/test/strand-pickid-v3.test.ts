/**
 * strand-pickid-v3.test — the v3 DAG identity rule (V3.1,
 * docs/specs/warpline-v3-identity.md §1, founder-signed §9).
 *
 *   pickId = pick:v3:H(parents + content) — NO ledger position, EVER.
 *
 * The load-bearing assertions:
 *   - determinism: same parents + content → same id (the exchange precondition);
 *   - position-freedom: seq/parentStateId/merged/parentPickId/calibratedConfidence
 *     can NEVER move a v3 identity (explicit preimage, not a rest-spread);
 *   - parents are ORDERED and IN the identity (ancestry is identity, §1.3);
 *   - recordedAt stays IN (signed §9.5); sessionKey stays OUT; agentId stays IN;
 *   - the merge recipe folds WHOLE (closes MED-D structurally — §1.1), unlike v2;
 *   - binding.treeId folds in and is MANDATORY at build (bind-on-seal, §1.1);
 *   - buildStrandV3 output carries no positional/mutable fields at all.
 */

import { describe, it, expect } from 'vitest';
import {
  buildStrandV3,
  computePickId,
  reproducesUnderKnownRule,
  type Strand,
  type StrandBody,
  type StrandV3Input,
} from '../src/fabric/strand.js';

const T_A = 'tree:v1:' + 'a'.repeat(64);
const T_B = 'tree:v1:' + 'b'.repeat(64);
const T_C = 'tree:v1:' + 'c'.repeat(64);
const T_R = 'tree:v1:' + 'd'.repeat(64);
const P_1 = 'pick:v3:' + '1'.repeat(64);
const P_2 = 'pick:v3:' + '2'.repeat(64);

const EMPTY_DELTA = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

function v3Input(over: Partial<StrandV3Input> = {}): StrandV3Input {
  return {
    parents: [P_1],
    stateId: 'state:v0:abc',
    actor: 'tester',
    authoredBy: { agentId: 'kit' },
    intent: 'a v3 strand',
    recordedAt: '2026-07-16T00:00:00.000Z',
    objectCount: 3,
    delta: { ...EMPTY_DELTA },
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    binding: { treeId: T_A, gitOid: null },
    ...over,
  };
}

describe('v3 identity · determinism (same parents + content → same id)', () => {
  it('builds byte-identically twice and mints pick:v3:', () => {
    const a = buildStrandV3(v3Input());
    const b = buildStrandV3(v3Input());
    expect(a.pickId).toBe(b.pickId);
    expect(a.pickId.startsWith('pick:v3:')).toBe(true);
    expect(a).toEqual(b); // full byte identity — the dedup/idempotence property (§1.3)
  });

  it('survives a JSON round-trip (the exchange path re-verifies the same id)', () => {
    const s = buildStrandV3(v3Input());
    const back = JSON.parse(JSON.stringify(s)) as Strand;
    const { pickId, ...body } = back;
    expect(computePickId(body)).toBe(pickId);
    expect(reproducesUnderKnownRule(back)).toBe(true);
  });

  it('a tampered v3 strand does NOT reproduce under any known rule', () => {
    const s = buildStrandV3(v3Input());
    expect(reproducesUnderKnownRule({ ...s, intent: 'forged' })).toBe(false);
  });
});

describe('v3 identity · NO ledger position, ever (§1.1 — the whole point)', () => {
  it('a stray seq / parentStateId / merged / parentPickId / mergeParentPickId cannot move the id', () => {
    const clean = buildStrandV3(v3Input());
    const { pickId: _p, ...body } = clean;
    const polluted: StrandBody = {
      ...body,
      seq: 42,
      parentStateId: 'state:v0:sneaky',
      merged: true,
      parentPickId: P_2,
      mergeParentPickId: P_2,
    };
    expect(computePickId(polluted)).toBe(clean.pickId);
  });

  it('calibratedConfidence cannot move the id (it does not exist on v3 — §7)', () => {
    const clean = buildStrandV3(v3Input());
    const { pickId: _p, ...body } = clean;
    expect(computePickId({ ...body, calibratedConfidence: 0.9 })).toBe(clean.pickId);
  });

  it('buildStrandV3 output carries no positional/mutable fields at all', () => {
    const s = buildStrandV3(v3Input()) as unknown as Record<string, unknown>;
    for (const gone of ['seq', 'parentStateId', 'merged', 'parentPickId', 'mergeParentPickId', 'calibratedConfidence']) {
      expect(gone in s, `${gone} must not exist on a v3 strand`).toBe(false);
    }
    expect(s.schemaVersion).toBe(3);
  });
});

describe('v3 identity · what is IN the hash', () => {
  const base = (): string => buildStrandV3(v3Input()).pickId;

  it('parents are IN — different parents → different id; ORDER matters', () => {
    expect(buildStrandV3(v3Input({ parents: [P_2] })).pickId).not.toBe(base());
    const ab = buildStrandV3(v3Input({ parents: [P_1, P_2], merge: { algo: 'warpline-merge3-v1', base: T_B, ours: T_C, theirs: T_C, result: T_A } }));
    const ba = buildStrandV3(v3Input({ parents: [P_2, P_1], merge: { algo: 'warpline-merge3-v1', base: T_B, ours: T_C, theirs: T_C, result: T_A } }));
    expect(ab.pickId).not.toBe(ba.pickId); // parents[0] is the PRIMARY parent — ordered, not a set
  });

  it('recordedAt is IN (signed §9.5 — identical-content retries must not collide)', () => {
    expect(buildStrandV3(v3Input({ recordedAt: '2026-07-16T00:00:00.001Z' })).pickId).not.toBe(base());
  });

  it('agentId is IN; sessionKey is stored but EXCLUDED', () => {
    expect(buildStrandV3(v3Input({ authoredBy: { agentId: 'other' } })).pickId).not.toBe(base());
    const withKey = buildStrandV3(v3Input({ authoredBy: { agentId: 'kit', sessionKey: 'sess-123' } }));
    expect(withKey.pickId).toBe(base());
    expect(withKey.authoredBy?.sessionKey).toBe('sess-123'); // stored breadcrumb
  });

  it('binding.treeId is IN; binding.gitOid is EXCLUDED (coexistence breadcrumb)', () => {
    expect(buildStrandV3(v3Input({ binding: { treeId: T_B, gitOid: null } })).pickId).not.toBe(base());
    expect(buildStrandV3(v3Input({ binding: { treeId: T_A, gitOid: 'f'.repeat(40) } })).pickId).toBe(base());
  });

  it('the merge recipe folds WHOLE (vs v2, which excludes the recipe trees) — §1.1 MED-D', () => {
    const recipe = { algo: 'warpline-merge3-v1' as const, base: T_B, ours: T_C, theirs: T_C, result: T_A };
    const m1 = buildStrandV3(v3Input({ parents: [P_1, P_2], merge: recipe }));
    const m2 = buildStrandV3(v3Input({ parents: [P_1, P_2], merge: { ...recipe, base: T_R } }));
    expect(m1.pickId).not.toBe(m2.pickId); // v3: a claimed merge input IS identity

    // Contrast: the v2 rule is UNCHANGED — recipe trees stay excluded there.
    const v2Body: StrandBody = {
      schemaVersion: 2,
      seq: 5,
      parentPickId: P_1,
      stateId: 'state:v0:abc',
      parentStateId: 'state:v0:parent',
      actor: 'tester',
      intent: 'v2 merge',
      recordedAt: '2026-07-16T00:00:00.000Z',
      objectCount: 3,
      delta: { ...EMPTY_DELTA },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      binding: { treeId: T_A, gitOid: null },
      merge: recipe,
    };
    expect(computePickId(v2Body)).toBe(computePickId({ ...v2Body, merge: { ...recipe, base: T_R } }));
  });
});

describe('v3 identity · buildStrandV3 guards (the schema-level invariants)', () => {
  it('refuses an unbound strand — bind-on-seal is the only v3 write path', () => {
    expect(() => buildStrandV3({ ...v3Input(), binding: undefined as unknown as { treeId: string } })).toThrow(/binding\.treeId is mandatory/);
  });

  it('refuses malformed parents (non-pickId, duplicates)', () => {
    expect(() => buildStrandV3(v3Input({ parents: ['state:v0:notapick'] }))).toThrow(/not a pickId/);
    expect(() => buildStrandV3(v3Input({ parents: [P_1, P_1] }))).toThrow(/duplicate parent/);
  });

  it('refuses a merge recipe with fewer than 2 parents (merged-ness is DERIVED)', () => {
    expect(() =>
      buildStrandV3(v3Input({ parents: [P_1], merge: { algo: 'warpline-merge3-v1', base: T_B, ours: T_C, theirs: T_C, result: T_A } })),
    ).toThrow(/requires 2\+ parents/);
  });

  it('accepts a genesis (parents: []) — the fresh-repo root (§1.3)', () => {
    const g = buildStrandV3(v3Input({ parents: [] }));
    expect(g.parents).toEqual([]);
    expect(reproducesUnderKnownRule(g)).toBe(true);
  });
});

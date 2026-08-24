/**
 * strand-sig-preimage.test — M3-lite I3, THE dangerous-edit regression
 * (m3-integrity-design-2026-08-23.md §3, "Storage hazard"): `sig` must be
 * EXCLUDED from the pickId preimage in BOTH current sealing epochs.
 *
 * WHY THIS IS THE ONE EDIT THAT CAN SILENTLY CORRUPT IDENTITY. The signature is
 * computed OVER the pickId; if it then leaked INTO the preimage (the v2 rule's
 * `...rest` spread would pick up any field not destructured out), every signed
 * strand's stored pickId would stop reproducing — and `reproducesUnderKnownRule`
 * would call the whole signed history a tamper. Both directions are pinned:
 *
 *   - EXCLUDED  — with-sig === without-sig for v2 AND v3 (attaching/stripping a
 *                 sig never moves the identity);
 *   - NOT INERT — the test is not vacuous: a REAL identity field (intent) moving
 *                 DOES move the pickId under both rules;
 *   - v1 FAIL-CLOSED — the retired v1 rule deliberately does NOT exclude sig:
 *                 no v1 strand can legitimately carry one (v1 predates the
 *                 signing epoch), so a grafted sig breaks the self-hash. Pinned
 *                 so nobody "helpfully" adds the exclusion later.
 */

import { describe, it, expect } from 'vitest';
import { computePickId, computeLegacyBodyHash, type Strand, type StrandBody } from '../src/fabric/strand.js';

const SIG: NonNullable<Strand['sig']> = {
  keyId: 'wlkey:v1:' + 'ab'.repeat(32),
  sigBase64: 'c2lnbmF0dXJlLWJ5dGVz',
  principal: 'alice',
  schemaVersion: 'strandSig:v1',
};

const DELTA = { born: ['alpha'], retired: [], contractChanged: [], renamedNoop: 0 };
const PROVENANCE = { ref: 'WORKTREE', treeSha: null, gitCommit: null };

const V2_BODY: StrandBody = {
  schemaVersion: 2,
  seq: 3,
  parentPickId: 'pick:v2:' + '11'.repeat(32),
  stateId: 'warp:' + '22'.repeat(32),
  parentStateId: 'warp:' + '33'.repeat(32),
  actor: 'alice',
  authoredBy: { agentId: 'alice', sessionKey: 'sess-1' },
  intent: 'add alpha',
  recordedAt: '2026-08-23T00:00:00.000Z',
  objectCount: 4,
  delta: DELTA,
  calibratedConfidence: null,
  provenance: PROVENANCE,
  binding: { treeId: 'tree:' + '44'.repeat(32), gitOid: null },
};

const V3_BODY: StrandBody = {
  schemaVersion: 3,
  parents: ['pick:v3:' + '55'.repeat(32)],
  stateId: 'warp:' + '22'.repeat(32),
  actor: 'alice',
  authoredBy: { agentId: 'alice', sessionKey: 'sess-1' },
  intent: 'add alpha',
  recordedAt: '2026-08-23T00:00:00.000Z',
  objectCount: 4,
  delta: DELTA,
  provenance: PROVENANCE,
  binding: { treeId: 'tree:' + '44'.repeat(32), gitOid: null },
};

const V1_BODY: StrandBody = {
  schemaVersion: 1,
  seq: 0,
  stateId: 'warp:' + '22'.repeat(32),
  parentStateId: null,
  actor: 'alice',
  intent: 'genesis',
  recordedAt: '2026-08-23T00:00:00.000Z',
  objectCount: 4,
  delta: DELTA,
  calibratedConfidence: null,
  provenance: PROVENANCE,
};

describe('sig is EXCLUDED from the pickId preimage (v2 — the `...rest` spread rule)', () => {
  it('computePickId(with-sig) === computePickId(without-sig)', () => {
    expect(computePickId({ ...V2_BODY, sig: SIG })).toBe(computePickId(V2_BODY));
  });

  it('MUTATING the sig does not move the pickId (excluded, not merely tolerated)', () => {
    const a = computePickId({ ...V2_BODY, sig: SIG });
    const b = computePickId({ ...V2_BODY, sig: { ...SIG, sigBase64: 'ZGlmZmVyZW50', principal: 'mallory' } });
    expect(a).toBe(b);
  });

  it('the test is NOT vacuous: a real identity field moving DOES move the pickId', () => {
    expect(computePickId({ ...V2_BODY, intent: 'something else' })).not.toBe(computePickId(V2_BODY));
  });
});

describe('sig is EXCLUDED from the pickId preimage (v3 — the explicit preimage, safe by construction)', () => {
  it('computePickId(with-sig) === computePickId(without-sig)', () => {
    expect(computePickId({ ...V3_BODY, sig: SIG })).toBe(computePickId(V3_BODY));
  });

  it('MUTATING the sig does not move the pickId', () => {
    const a = computePickId({ ...V3_BODY, sig: SIG });
    const b = computePickId({ ...V3_BODY, sig: { ...SIG, keyId: 'wlkey:v1:' + 'ff'.repeat(32) } });
    expect(a).toBe(b);
  });

  it('the test is NOT vacuous: a real identity field moving DOES move the pickId', () => {
    expect(computePickId({ ...V3_BODY, intent: 'something else' })).not.toBe(computePickId(V3_BODY));
  });
});

describe('v1 stays FAIL-CLOSED (no exclusion — a grafted sig must break the self-hash)', () => {
  it('a sig grafted onto a v1 body CHANGES the pickId (pre-epoch strands never carry one)', () => {
    expect(computePickId({ ...V1_BODY, sig: SIG })).not.toBe(computePickId(V1_BODY));
  });

  it('a sig grafted onto a grandfathered body CHANGES the pinned legacy body hash (legacy-body-mismatch, HARD)', () => {
    expect(computeLegacyBodyHash({ ...V1_BODY, sig: SIG })).not.toBe(computeLegacyBodyHash(V1_BODY));
  });
});

/**
 * Voice golden (TD-2026-10-19-194, T-2026-10-19-026), kernel half: every voice slice leaves the kernel ABI where it
 * is. `abiId` hashes the verbs, the relays and NEXT_LEGAL_TABLE (src/kernel/socket/dispatch.ts); no voice slice may
 * touch any of them. This pins the LITERAL, not test/abi.ids.json, so a regenerated pin file cannot move it.
 * The client API id is pinned the same way in packages/gnomon-contracts/test/voice-golden.test.ts.
 *
 * Also: every (kind, decision) pair gnomon-contracts' VOICE_ALLOWLIST admits is a decision #approval-broker's
 * KIND_DECISIONS gives that kind, so the voice list never names a decision the broker would refuse as invalid.
 */
import { describe, expect, it } from 'vitest';
import { CARD_KINDS, CLIENT_API_ID, VOICE_ALLOWLIST } from '@a-company/gnomon-contracts';
import { ABI_ID } from '../src/kernel/socket/dispatch.js';
import { KIND_DECISIONS } from '../src/kernel/broker/classes.js';

const GOLDEN_ABI_ID = 'sha256:18357f4420e34c2959102ff01f8279736ba69f2d9f011421895fd1ce39cfa3fa';
const GOLDEN_CLIENT_API_ID = 'sha256:f27ecb8b3ee5c1a4ad08d4c5eda427a63aebba8ba31963baed3c9d53e3e611a4';

describe('voice golden: abiId and clientApiId are unchanged by every voice slice', () => {
  it('ABI_ID and CLIENT_API_ID equal the pre-voice literals', () => {
    expect(ABI_ID).toBe(GOLDEN_ABI_ID);
    expect(CLIENT_API_ID).toBe(GOLDEN_CLIENT_API_ID);
  });
});

describe('voice allowlist ⊆ broker decisions (§14.7, classes.ts)', () => {
  it('every allowlisted decision is a valid decision of its kind; every kind has a broker row', () => {
    for (const kind of CARD_KINDS) {
      const valid = Object.keys(KIND_DECISIONS[kind]);
      const row = VOICE_ALLOWLIST[kind];
      for (const d of [...Object.values(row.approve).flat(), ...row.deny]) expect(valid, `${kind}:${d}`).toContain(d);
      // D66: the deny row names the kind's deny-direction decision whenever the broker gives it one.
      const brokerDenies = valid.filter((d) => d === 'deny' || d === 'reject');
      expect([...row.deny].sort(), kind).toEqual(brokerDenies.sort());
    }
  });
});

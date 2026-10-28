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

// 8.0:loops: loop-trust is never by voice, deny included (gnomon-loops.md §3.1, §7)
const FULLY_HAND_ONLY: readonly string[] = ['incident', 'daemon-stop', 'loop-trust'];
const GOLDEN_ABI_ID = 'sha256:f54aa03625d414234bce961059fb6584a9acc31ea8b97b3dc28b9afa0db26a35';
const GOLDEN_CLIENT_API_ID = 'sha256:58e120257782b0da3327aecc4489571fb651ac5cb91e4003da51bd28e96de405';

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
      // Founder ruling (TD-2026-10-19-677, Aegis M2): incident and daemon-stop are fully hand-only, deny included.
      const brokerDenies = FULLY_HAND_ONLY.includes(kind) ? [] : valid.filter((d) => d === 'deny' || d === 'reject');
      expect([...row.deny].sort(), kind).toEqual(brokerDenies.sort());
    }
  });
});

/**
 * #kernel-log quarantine logic that writes no key (T-2026-10-17-009(a)):
 * the crash-injection step list, the M1.3 keystore tripwire, and evidence
 * names valid under Windows path rules. Platform-independent (runs on
 * win32 too); the cases that build a quarantined home are in
 * test/kernel-log-quarantine.test.ts (darwin/linux, G-WIN-05 registry row).
 */
import { describe, expect, it } from 'vitest';
import { evidenceNameFor, KeystoreAnchorStore, QUARANTINE_STEPS } from '../src/kernel/log/index.js';

describe('#kernel-log quarantine steps and keystore tripwire', () => {
  it('every step is covered', () => {
    expect([...QUARANTINE_STEPS]).toEqual(['identity-read', 'staging-created', 'staged', 'evidence-renamed', 'moved', 'installed']);
  });

  it('M1.3 TRIPWIRE (T-2026-10-18-007): the keystore anchor is still the stub; when it becomes real, re-check that quarantine never lets the per-user anchor speak for a staging/evidence/non-default home (OPEN 19)', () => {
    expect(new KeystoreAnchorStore().read().state, 'KeystoreAnchorStore is real now: revisit verifiedQuarantineGenesis / readQuarantineIdentity per T-2026-10-18-007 and spec §22 OPEN 19').toBe('unavailable');
  });
});

describe('#kernel-log quarantine evidence names are valid on every platform (Windows path rules)', () => {
  it('stamp has no Windows-reserved character, no trailing dot/space; the evidence is a sibling of the home', () => {
    const n = evidenceNameFor('.gnomon', new Date('2026-10-18T01:02:03.456Z'), 'deadbeef');
    expect(n).toBe('.gnomon.quarantine-20261018T010203Z-deadbeef');
    expect(n).not.toMatch(/[<>:"/\\|?*]/);
    expect(n).not.toMatch(/[. ]$/);
    expect(evidenceNameFor('gnomon', new Date()).length).toBeLessThan(64);
    expect(() => evidenceNameFor('bad:name', new Date())).toThrow(RangeError);
    expect(() => evidenceNameFor('trailing', new Date(), 'x.')).toThrow(RangeError);
  });
});

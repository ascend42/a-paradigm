/**
 * Voice golden (TD-2026-10-19-194, T-2026-10-19-026): every voice slice after V0 must leave the published client API
 * where it is. V0 moved `clientApiId` ONCE, deliberately, before any client ships (founder ruling: VOICE_DISARM_REASONS,
 * the voice-strictness ceiling, status.arms / status.armCustody; was sha256:f27ecb8b…11a4). No later voice slice adds
 * or renames an enum value, so `clientApiId` / `kitId` stay put. This pins the LITERALS, not the
 * committed schemas/client-api.ids.json, so a regenerated pin file cannot silently move them.
 * The kernel's `abiId` is pinned the same way in packages/gnomon/test/voice-golden.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, CLIENT_API_ID, computeClientApiId, KIT_ID, STATUS_RESERVED_FIELDS, VOICE_ALLOWLIST, VOICE_CLOSED_VALUES, VOICE_DISARM_REASONS } from '../src/index.js';

const GOLDEN_CLIENT_API_ID = 'sha256:40efb7259e10d288f08c951ea22af72c76d149a6bd38c395ae7df3dfa8942afd';

describe('voice golden: clientApiId is unchanged by every voice slice', () => {
  it('CLIENT_API_ID equals the pre-voice literal and recomputes to it', () => {
    expect(CLIENT_API_ID).toBe(GOLDEN_CLIENT_API_ID);
    expect(computeClientApiId()).toBe(GOLDEN_CLIENT_API_ID);
  });

  it('the voice allowlist is not a clientApiId input (pure data beside the descriptor)', () => {
    expect(VOICE_ALLOWLIST).toBeDefined();
    expect(KIT_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeClientApiId()).toBe(GOLDEN_CLIENT_API_ID);
  });
});

describe('voice reservations (TD-2026-10-19-194, founder ruling)', () => {
  it('VOICE_DISARM_REASONS is the ruled list plus the three §14.7 triggers it missed, closed and in clientApiId', () => {
    expect([...VOICE_DISARM_REASONS]).toEqual([
      'idle', 'hard', 'limit', 'conn-closed', 'voice-conn', 'screen-lock', 'display-sleep', 'user-switch', 'system-sleep',
      'policy', 'config', 'mode-set', 'phrase', 'gui', 'cli', 'unenrolled', 'daemon-exit', 'helper-exit', 'handle-miss',
      'challenge-miss', 'refused-streak',
    ]);
    expect(VOICE_CLOSED_VALUES['approval.voice.disarm.reason']).toEqual([...VOICE_DISARM_REASONS]);
    expect(VOICE_CLOSED_VALUES['refusal.voice-strictness.ceiling']).toEqual(['null-level', 'manual']);
    expect((CLIENT_API_DESCRIPTOR as unknown as { voiceClosedValues: unknown }).voiceClosedValues).toBe(VOICE_CLOSED_VALUES);
    const moved = JSON.parse(JSON.stringify(CLIENT_API_DESCRIPTOR));
    moved.voiceClosedValues['approval.voice.disarm.reason'].push('extra');
    expect(computeClientApiId(moved)).not.toBe(GOLDEN_CLIENT_API_ID);
  });

  it('status.arms and status.armCustody are reserved status fields', () => {
    expect(STATUS_RESERVED_FIELDS).toMatchObject({ arms: { section: '§14.7' }, armCustody: { section: '§14.7' } });
  });
});

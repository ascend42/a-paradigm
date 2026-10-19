/**
 * Voice golden (TD-2026-10-19-194, T-2026-10-19-026): every voice slice (V0..) must leave the published client API
 * where it is. The D58 voice values were reserved in M1.1 (card.ts, refusal.ts, principal.ts, event.ts), so no voice
 * slice adds or renames an enum value and `clientApiId` / `kitId` stay put. This pins the LITERALS, not the
 * committed schemas/client-api.ids.json, so a regenerated pin file cannot silently move them.
 * The kernel's `abiId` is pinned the same way in packages/gnomon/test/voice-golden.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_ID, computeClientApiId, KIT_ID, VOICE_ALLOWLIST } from '../src/index.js';

const GOLDEN_CLIENT_API_ID = 'sha256:f27ecb8b3ee5c1a4ad08d4c5eda427a63aebba8ba31963baed3c9d53e3e611a4';

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

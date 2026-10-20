/**
 * TD-2026-10-20-086 F6 + T-2026-10-20-007: the daily standing grant's kinds and closed values, approval.auto.miss and
 * approval.auto{anchoredInputHash}: one deliberate clientApiId move (old sha256:ac22e72f…, new sha256:ebf32456…).
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, CLIENT_API_ID, defaultLabelsFor, EVENT_KINDS, RESERVED_KIND_PAYLOADS, RESERVED_PAYLOAD_FIELDS, STANDING_GRANT_MAX_MS, STANDING_PRESENCE_PREFIX, STANDING_REVOKE_REASONS, STANDING_TUPLES } from '../src/index.js';

describe('standing grant contracts (F6)', () => {
  it('the kinds exist, kernel-owned, tagged with the ruling', () => {
    for (const k of ['grant.standing', 'grant.standing.used', 'grant.standing.revoked', 'request.grant.standing', 'request.grant.standing.revoke', 'approval.auto.miss']) {
      expect(EVENT_KINDS[k], k).toMatchObject({ owner: 'kernel', reserved: '8.0:TD-2026-10-20-086' });
      expect(RESERVED_KIND_PAYLOADS[k], k).toBeDefined();
    }
  });
  it('the tuples never name a root, install, gate-class, fallback, declassify or peer decision', () => {
    expect([...STANDING_TUPLES]).toEqual(['mode.loosen:auto-edits', 'permission:always', 'voice.widen', 'voice-arm:allow', 'daemon-stop:restart', 'reconsider:extend']);
    for (const t of STANDING_TUPLES) for (const banned of ['install', 'gate-class', 'fallback', 'declassify', 'peer', 'grant', 'api-token', 'repin']) expect(t).not.toContain(banned);
  });
  it('closed values ride the clientApiId descriptor', () => {
    expect((CLIENT_API_DESCRIPTOR as unknown as { standingGrant: unknown }).standingGrant).toEqual({ tuples: [...STANDING_TUPLES], revokeReasons: [...STANDING_REVOKE_REASONS], presencePrefix: STANDING_PRESENCE_PREFIX, maxMs: STANDING_GRANT_MAX_MS });
    expect(STANDING_GRANT_MAX_MS).toBe(12 * 3600_000);
    expect(CLIENT_API_ID).toBe('sha256:ebf32456626d7f80f7a6b7e90ab48270476c120e3f80336b3c762d8289a05c01');
  });
  it('approval.auto.miss is a sensitive kind whose why and inputHash are sensitive fields; approval.auto gains anchoredInputHash', () => {
    expect(defaultLabelsFor('approval.auto.miss').sensitivity).toBe('sensitive');
    expect(EVENT_KINDS['approval.auto.miss']!.fieldLabels).toEqual({ why: 'sensitive', inputHash: 'sensitive' });
    expect(RESERVED_PAYLOAD_FIELDS['approval.auto']).toEqual({ anchoredInputHash: '8.0:TD-2026-10-20-086' });
  });
});

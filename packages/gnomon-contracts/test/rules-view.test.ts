/**
 * 8.0:rules-view (session 2026-10-23-gnomon-rules-view; Aegis M2/L1/L2): approval.rule.disabled and
 * approval.rule.enabled, closed payloads, and the rulesView descriptor — one deliberate clientApiId move.
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_API_DESCRIPTOR,
  CLIENT_API_ID,
  EVENT_KINDS,
  KIND_PAYLOADS,
  kindOwner,
  RESERVATION_TAGS,
  RULE_CHANGE_OPS,
  RULE_ENABLE_CAUSES,
  RULE_OFF_MAX_MS,
  RULES_APPLY_MAX,
  RULES_BATCH_PATTERN,
  validateKindPayload,
} from '../src/index.js';

const ULID = '01J9Z8Y7X6W5V4T3S2R1Q0P9N8';
const base = { ruleId: `card:${ULID}`, repoKey: `sha256:${'b'.repeat(64)}`, tool: 'Bash' };

describe('8.0:rules-view kinds', () => {
  it('both kinds are kernel-owned and reserved under 8.0:rules-view', () => {
    expect(RESERVATION_TAGS).toContain('8.0:rules-view');
    for (const k of ['approval.rule.disabled', 'approval.rule.enabled']) {
      expect(EVENT_KINDS[k]?.reserved).toBe('8.0:rules-view');
      expect(kindOwner(k)).toBe('kernel');
      expect(KIND_PAYLOADS[k]).toBeDefined();
    }
  });
  it('approval.rule.disabled: until is an ISO time or null; batch and connId are required', () => {
    const ok = { ...base, until: '2026-10-23T15:07:00.000Z', batch: `batch:${ULID}`, connId: `conn:${ULID}` };
    expect(validateKindPayload('approval.rule.disabled', ok)).toEqual([]);
    expect(validateKindPayload('approval.rule.disabled', { ...ok, until: null })).toEqual([]);
    expect(validateKindPayload('approval.rule.disabled', { ...ok, until: 'tomorrow' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.rule.disabled', { ...ok, batch: 'b1' }).length).toBeGreaterThan(0);
    const { batch: _b, ...noBatch } = ok;
    expect(validateKindPayload('approval.rule.disabled', noBatch).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.rule.disabled', { ...ok, extra: 1 }).length).toBeGreaterThan(0);
  });
  it("approval.rule.enabled: cause 'human' names batch, connId, the card and the until it clears; cause 'expired' names only until", () => {
    // Aegis M-2: the allowed card names the off flag it clears (an ISO until, or null = the off had no end)
    const human = { ...base, cause: 'human', batch: `batch:${ULID}`, connId: `conn:${ULID}`, cardId: `card:${ULID}`, until: null };
    const expired = { ...base, cause: 'expired', until: '2026-10-23T15:07:00.000Z' };
    expect(validateKindPayload('approval.rule.enabled', human)).toEqual([]);
    expect(validateKindPayload('approval.rule.enabled', expired)).toEqual([]);
    expect(validateKindPayload('approval.rule.enabled', { ...human, until: expired.until })).toEqual([]);
    const { until: _u, ...noUntil } = human;
    expect(validateKindPayload('approval.rule.enabled', noUntil).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.rule.enabled', { ...expired, until: null }).length).toBeGreaterThan(0);
    const { cardId: _c, ...noCard } = human;
    expect(validateKindPayload('approval.rule.enabled', noCard).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.rule.enabled', { ...expired, batch: `batch:${ULID}` }).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.rule.enabled', { ...base, cause: 'expired' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('approval.rule.enabled', { ...expired, cause: 'voice' }).length).toBeGreaterThan(0);
  });
  it('the descriptor publishes the batch rules (one clientApiId move)', () => {
    expect(RULE_CHANGE_OPS).toEqual(['remove', 'off', 'on']);
    expect(RULE_ENABLE_CAUSES).toEqual(['human', 'expired']);
    expect(RULES_APPLY_MAX).toBe(64);
    expect(RULE_OFF_MAX_MS).toBe(7 * 24 * 3_600_000);
    expect(RULES_BATCH_PATTERN.test(`batch:${ULID}`)).toBe(true);
    expect((CLIENT_API_DESCRIPTOR as unknown as Record<string, unknown>).rulesView).toEqual({ request: 'request.rules.apply', max: 64, ops: ['remove', 'off', 'on'], offMaxMs: RULE_OFF_MAX_MS, untilManual: 'manual', enableCauses: ['human', 'expired'], batchPattern: RULES_BATCH_PATTERN.source, cardOp: 'rules.apply' });
    // moved again after this one by 8.0:git-verbs (merged later): the live pin is m1-1-reservations' PINNED_CLIENT_API_ID
    expect(CLIENT_API_ID).toBe('sha256:238f2221e356599942e281abcb843ce7c37947aff96108dea5909b0f19336824');
  });
});

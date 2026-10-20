/**
 * 8.0:model-switch: the mid-session Claude model switch's closed kinds. Falsifiers: every outcome is in the
 * descriptor, the payload checks are closed (an unknown outcome, a flag-looking model, a refused permit with an id),
 * and `reconciled` alone may land back on 'claude' (Claude Code's default).
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, MODEL_SWITCH_REASON_ROUTES, SESSION_MODEL_OUTCOMES, mintHsid, validateKindPayload } from '../src/index.js';

const hsid = mintHsid();
const permitId = 'permit:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';

describe('8.0:model-switch kinds', () => {
  it('the descriptor carries every outcome, the refusal routes and the context guard', () => {
    const d = CLIENT_API_DESCRIPTOR as unknown as { modelSwitch: { outcomes: string[]; reasons: Record<string, unknown>; contextGuard: { fromSuffix: string; maxTokens: number } } };
    expect(d.modelSwitch.outcomes).toEqual(['switched', 'backend-refused', 'timeout', 'permit-refused', 'reconciled']);
    expect(d.modelSwitch.outcomes).toEqual([...SESSION_MODEL_OUTCOMES]);
    expect(Object.keys(d.modelSwitch.reasons)).toEqual(Object.keys(MODEL_SWITCH_REASON_ROUTES));
    expect(d.modelSwitch.contextGuard).toEqual({ fromSuffix: '[1m]', maxTokens: 160_000 });
  });
  it('request.session.model takes an hsid and a Claude model only', () => {
    expect(validateKindPayload('request.session.model', { hsid, model: 'sonnet' })).toEqual([]);
    expect(validateKindPayload('request.session.model', { hsid, model: '--verbose' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('request.session.model', { hsid, model: 'sonnet', extra: 1 }).length).toBeGreaterThan(0);
  });
  it.each(['switched', 'backend-refused', 'timeout', 'reconciled'])('session.model{%s} names a permit', (outcome) => {
    expect(validateKindPayload('session.model', { hsid, from: 'claude', to: 'sonnet', permitId, outcome })).toEqual([]);
    expect(validateKindPayload('session.model', { hsid, from: 'claude', to: 'sonnet', permitId: null, outcome }).length).toBeGreaterThan(0);
  });
  it('permit-refused has permitId null; an unknown outcome is refused', () => {
    expect(validateKindPayload('session.model', { hsid, from: 'haiku', to: 'sonnet', permitId: null, outcome: 'permit-refused' })).toEqual([]);
    expect(validateKindPayload('session.model', { hsid, from: 'haiku', to: 'sonnet', permitId, outcome: 'permit-refused' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.model', { hsid, from: 'haiku', to: 'sonnet', permitId, outcome: 'maybe' }).length).toBeGreaterThan(0);
  });
  it("only reconciled may land on 'claude' (back to the default)", () => {
    expect(validateKindPayload('session.model', { hsid, from: 'claude', to: 'claude', permitId, outcome: 'reconciled' })).toEqual([]);
    expect(validateKindPayload('session.model', { hsid, from: 'sonnet', to: 'claude', permitId, outcome: 'switched' }).length).toBeGreaterThan(0);
  });
});

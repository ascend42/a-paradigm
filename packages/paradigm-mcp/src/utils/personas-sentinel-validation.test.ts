/**
 * validateAgainstSentinel — the LATEST event per step decides the verdict.
 * Sentinel's queryEvents returns newest first; an older failure must not
 * outlive a newer pass.
 */
import { describe, it, expect, vi } from 'vitest';
import type { GenericEvent, GenericEventQuery } from '@a-company/sentinel';

const events: GenericEvent[] = [];

vi.mock('@a-company/sentinel', () => ({
  SentinelStorage: class {
    queryEvents(q: GenericEventQuery = {}): GenericEvent[] {
      return events
        .filter((e) => (!q.eventType || e.eventType === q.eventType) && (!q.scopeValue || e.scopeValue === q.scopeValue))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // newest first, like storage.ts
    }
  },
}));

import { validateAgainstSentinel } from './personas-loader.js';
import type { Persona } from '../types/personas.js';

function stepEvent(eventType: string, timestamp: string, status: number): GenericEvent {
  return {
    id: `${eventType}-${timestamp}`,
    schemaId: 'paradigm-personas',
    eventType,
    category: 'assertion',
    timestamp,
    scopeValue: 'buyer',
    service: 'paradigm-personas',
    data: { persona_id: 'buyer', step_id: 'checkout', status },
  };
}

const persona: Persona = {
  version: '1.0',
  id: 'buyer',
  name: 'Buyer',
  trigger: { type: 'root' },
  journey: [{ id: 'checkout', route: 'POST /api/checkout', gates: [], expect: { status: 200 } }],
};

describe('validateAgainstSentinel', () => {
  it('an older fail followed by a newer pass reads as pass', async () => {
    events.length = 0;
    events.push(
      stepEvent('persona.step.fail', '2026-10-20T10:00:00.000Z', 500),
      stepEvent('persona.step.complete', '2026-10-21T10:00:00.000Z', 200),
    );
    const result = await validateAgainstSentinel(persona);
    expect(result.steps[0]).toMatchObject({ step_id: 'checkout', matched: true, passed: true });
    expect(result.summary.failed).toBe(0);
  });

  it('an older pass followed by a newer fail reads as fail', async () => {
    events.length = 0;
    events.push(
      stepEvent('persona.step.complete', '2026-10-20T10:00:00.000Z', 200),
      stepEvent('persona.step.fail', '2026-10-21T10:00:00.000Z', 500),
    );
    const result = await validateAgainstSentinel(persona);
    expect(result.steps[0]).toMatchObject({ matched: true, passed: false });
  });
});

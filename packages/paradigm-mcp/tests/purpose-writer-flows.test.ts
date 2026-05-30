/**
 * Tests for normalizeFlowsToRecord — the flow normalization helper in
 * purpose-writer.ts.
 *
 * Regression coverage for v6.6.2 Bug 3: an array-form flow entry without a
 * `name` coerced to the literal string key "undefined" in the flows: block.
 * Both the array branch and the record-passthrough branch must guard against
 * a "undefined" (or otherwise empty) key.
 */
import { describe, it, expect } from 'vitest';
import { normalizeFlowsToRecord } from '../src/utils/purpose-writer.js';

describe('normalizeFlowsToRecord', () => {
  it('returns an empty record for undefined input', () => {
    expect(normalizeFlowsToRecord(undefined)).toEqual({});
  });

  it('converts an array of named flows into a keyed record', () => {
    const result = normalizeFlowsToRecord([
      { name: 'checkout-flow', description: 'Checkout', steps: ['a', 'b'] },
      { name: 'login-flow', description: 'Login', steps: ['c'] },
    ] as never);

    expect(Object.keys(result).sort()).toEqual(['checkout-flow', 'login-flow']);
    expect(result['checkout-flow']).toEqual({ description: 'Checkout', steps: ['a', 'b'] });
  });

  it('skips array entries with no name instead of writing an "undefined" key (Bug 3)', () => {
    const result = normalizeFlowsToRecord([
      { description: 'nameless', steps: [] }, // no name
      { name: 'real-flow', description: 'ok', steps: [] },
    ] as never);

    expect(result).not.toHaveProperty('undefined');
    expect(Object.keys(result)).toEqual(['real-flow']);
  });

  it('skips null/undefined array entries without throwing', () => {
    const result = normalizeFlowsToRecord([
      null,
      undefined,
      { name: 'survivor', description: 'ok', steps: [] },
    ] as never);

    expect(Object.keys(result)).toEqual(['survivor']);
  });

  it('strips a poisoned "undefined" key from record-format input (Bug 3 cleanup)', () => {
    const result = normalizeFlowsToRecord({
      undefined: {} as never,
      'guide-chat-flow': { description: 'Guide chat', steps: [] } as never,
    } as never);

    expect(result).not.toHaveProperty('undefined');
    expect(Object.keys(result)).toEqual(['guide-chat-flow']);
  });

  it('drops empty-string keys from record-format input', () => {
    const result = normalizeFlowsToRecord({
      '': { description: 'blank key', steps: [] } as never,
      'kept-flow': { description: 'kept', steps: [] } as never,
    } as never);

    expect(Object.keys(result)).toEqual(['kept-flow']);
  });

  it('passes through a clean record unchanged', () => {
    const input = {
      'a-flow': { description: 'A', steps: [] } as never,
      'b-flow': { description: 'B', steps: [] } as never,
    };
    const result = normalizeFlowsToRecord(input as never);
    expect(result).toEqual(input);
  });
});

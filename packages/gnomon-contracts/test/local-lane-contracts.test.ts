/**
 * 8.0:local-lane (TD-2026-10-27-833 slice C1, #local-tool-broker): the
 * tool.brokered kind is registered, closed and HASH-ONLY.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, EVENT_KINDS, KIND_PAYLOADS, TOOL_BROKERED_DECISIONS, validateKindPayload } from '../src/index.js';

const HSID = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const row = { hsid: HSID, server: 'gnomon', tool: 'gnomon_git_push', class: 'destructive', argsHash: `sha256:${'a'.repeat(64)}`, decision: 'approved', bytes: 12, isError: false, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ' };

describe('tool.brokered (8.0:local-lane)', () => {
  it('is a kernel kind, sensitive, reserved under 8.0:local-lane, with a closed payload', () => {
    expect(EVENT_KINDS['tool.brokered']).toMatchObject({ kind: 'tool.brokered', owner: 'kernel', sensitivity: 'sensitive', reserved: '8.0:local-lane' });
    expect(KIND_PAYLOADS['tool.brokered']).toEqual(['hsid', 'server', 'tool', 'class', 'argsHash', 'decision', 'bytes', 'isError', 'cardId']);
    expect((CLIENT_API_DESCRIPTOR as unknown as { toolBrokered: { decisions: string[] } }).toolBrokered.decisions).toEqual([...TOOL_BROKERED_DECISIONS]);
  });
  it('a valid row passes; an unresolved tool omits tool and class', () => {
    expect(validateKindPayload('tool.brokered', row)).toEqual([]);
    const { tool: _t, class: _c, cardId: _id, ...unknown } = row;
    expect(validateKindPayload('tool.brokered', { ...unknown, decision: 'unknown-tool', isError: true })).toEqual([]);
  });
  it('never carries args, output or free text: unknown keys, raw args and open values are refused', () => {
    expect(validateKindPayload('tool.brokered', { ...row, args: { remote: 'origin' } }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.brokered', { ...row, argsHash: '{"remote":"origin"}' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.brokered', { ...row, decision: 'maybe' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('tool.brokered', { ...row, tool: 'rm -rf /' }).length).toBeGreaterThan(0);
    const { class: _c, ...noClass } = row;
    expect(validateKindPayload('tool.brokered', noClass).length).toBeGreaterThan(0);
  });
});

/**
 * 8.0:local-lane (TD-2026-10-27-833 slice C1, #local-tool-broker): the
 * tool.brokered kind is registered, closed and HASH-ONLY.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_DESCRIPTOR, EVENT_KINDS, KIND_PAYLOADS, SESSION_MCP_ERROR_MAX, SESSION_MCP_FITS, SESSION_MCP_STATES, SESSION_MEMORY_OPS, TOOL_BROKERED_DECISIONS, validateKindPayload } from '../src/index.js';

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

/**
 * 8.0:local-lane (TD-2026-10-27-833 slice B2, #local-working-memory): session.memory is registered, closed and
 * HASH-ONLY (never the entry text); session.context labels a raise past the signed config.
 */
describe('session.memory and session.context (8.0:local-lane, slice B2)', () => {
  const mem = { hsid: HSID, op: 'add', id: 'wm-3', source: 'model', kind: 'note', textHash: `sha256:${'b'.repeat(64)}`, bytes: 42 };
  it('are kernel kinds reserved under 8.0:local-lane; session.memory is sensitive with a closed payload', () => {
    expect(EVENT_KINDS['session.memory']).toMatchObject({ kind: 'session.memory', owner: 'kernel', sensitivity: 'sensitive', reserved: '8.0:local-lane' });
    expect(EVENT_KINDS['session.context']).toMatchObject({ kind: 'session.context', owner: 'kernel', reserved: '8.0:local-lane' });
    expect(KIND_PAYLOADS['session.memory']).toEqual(['hsid', 'op', 'id', 'source', 'kind', 'textHash', 'bytes', 'why']);
    expect((CLIENT_API_DESCRIPTOR as unknown as { sessionMemory: { ops: string[] } }).sessionMemory.ops).toEqual([...SESSION_MEMORY_OPS]);
  });
  it('valid rows pass: an entry change, a refusal, a delete', () => {
    expect(validateKindPayload('session.memory', mem)).toEqual([]);
    expect(validateKindPayload('session.memory', { ...mem, source: 'tool:gnomon' })).toEqual([]);
    expect(validateKindPayload('session.memory', { hsid: HSID, op: 'refused', source: 'model', kind: 'note', bytes: 900, why: 'too-long' })).toEqual([]);
    expect(validateKindPayload('session.memory', { hsid: HSID, op: 'delete', bytes: 0 })).toEqual([]);
  });
  it('never carries the text or open values', () => {
    expect(validateKindPayload('session.memory', { ...mem, text: 'secret plan' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.memory', { ...mem, textHash: 'secret plan' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.memory', { ...mem, op: 'rewrite' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.memory', { ...mem, source: 'the model said so' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.memory', { ...mem, why: 'full' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.memory', { hsid: HSID, op: 'delete', id: 'wm-1', bytes: 0 }).length).toBeGreaterThan(0);
    const { textHash: _h, ...noHash } = mem;
    expect(validateKindPayload('session.memory', noHash).length).toBeGreaterThan(0);
  });
  it('session.context: aboveConfig is true exactly when the target is above the config', () => {
    const ctx = { hsid: HSID, target: 16384, previous: 8192, requested: 16384, configTarget: 8192, nCtx: 32768, aboveConfig: true };
    expect(validateKindPayload('session.context', ctx)).toEqual([]);
    expect(validateKindPayload('session.context', { ...ctx, nCtx: null })).toEqual([]);
    expect(validateKindPayload('session.context', { ...ctx, aboveConfig: false }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.context', { ...ctx, target: 4096, aboveConfig: false })).toEqual([]);
    expect(validateKindPayload('session.context', { ...ctx, why: 'x' }).length).toBeGreaterThan(0);
  });
});

describe("session.mcp (8.0:local-lane C6'a1)", () => {
  const started = { hsid: HSID, server: 'fake', state: 'started' };
  it('is a kernel kind under 8.0:local-lane whose error is a sensitive field, with closed state and fit', () => {
    expect(EVENT_KINDS['session.mcp']).toMatchObject({ kind: 'session.mcp', owner: 'kernel', sensitivity: 'normal', reserved: '8.0:local-lane', fieldLabels: { error: 'sensitive' } });
    expect(KIND_PAYLOADS['session.mcp']).toEqual(['hsid', 'server', 'state', 'fit', 'error']);
    expect((CLIENT_API_DESCRIPTOR as unknown as { sessionMcp: unknown }).sessionMcp).toEqual({ states: [...SESSION_MCP_STATES], fits: [...SESSION_MCP_FITS], errorMax: SESSION_MCP_ERROR_MAX });
  });
  it('started carries neither; refused carries fit; failed carries error', () => {
    expect(validateKindPayload('session.mcp', started)).toEqual([]);
    expect(validateKindPayload('session.mcp', { ...started, state: 'refused', fit: 'trust-changed' })).toEqual([]);
    expect(validateKindPayload('session.mcp', { ...started, state: 'refused', fit: 'disabled' })).toEqual([]);
    expect(validateKindPayload('session.mcp', { ...started, state: 'failed', error: 'exited with code 3' })).toEqual([]);
    expect(validateKindPayload('session.mcp', { ...started, state: 'refused' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, state: 'failed' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, fit: 'launch-writable' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, error: 'x' }).length).toBeGreaterThan(0);
  });
  it('refuses open values, an unlabelled server, control characters and an error past its cap', () => {
    expect(validateKindPayload('session.mcp', { ...started, state: 'crashed' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, state: 'refused', fit: 'because' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, server: 'Fake Server' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, state: 'failed', error: 'a\u0007b' }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, state: 'failed', error: 'e'.repeat(SESSION_MCP_ERROR_MAX + 1) }).length).toBeGreaterThan(0);
    expect(validateKindPayload('session.mcp', { ...started, command: 'node x' }).length).toBeGreaterThan(0);
  });
});

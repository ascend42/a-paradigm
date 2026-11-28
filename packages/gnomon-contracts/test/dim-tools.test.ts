/**
 * S1.4 helpers of `dim.ts` used by the dimension mod's agent tools: `dimOpOid` (Aegis A8), `dimRowBy`, and the
 * agreement between how the kernel builds a session principal and the pattern the tools and the view accept.
 */
import { describe, expect, it } from 'vitest';
import { DIM_OP_ID_PATTERN, DIM_VIEW_PRINCIPAL_PATTERN, dimOpOid, dimRowBy, hsidShort, mintHsid, NS_PATTERN, principalId, sha256Tagged } from '../src/index.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const D = 'dim:01JD1D00000000000000000001';

describe('dimOpOid (Aegis A8)', () => {
  it('is the first 16 hex of sha256(hsid, 0x00, dim, 0x00, opId) and names the session and the dimension', () => {
    expect(dimOpOid(H, D, 'draw-1')).toBe(sha256Tagged(`${H}\u0000${D}\u0000draw-1`).slice(7, 23));
    expect(dimOpOid(H, D, 'draw-1')).toMatch(/^[0-9a-f]{16}$/);
    expect(dimOpOid(H, D, 'draw-1')).not.toBe(dimOpOid('hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB', D, 'draw-1'));
    expect(dimOpOid(H, D, 'draw-1')).not.toBe(dimOpOid(H, 'dim:01JD1D00000000000000000002', 'draw-1'));
    // the separator makes the input unambiguous: moving characters across a boundary is another oid
    expect(dimOpOid('h', D, 'ab')).not.toBe(dimOpOid('h', D, 'a-b'));
  });

  it('is null for any part out of its form', () => {
    for (const [h, d, o] of [
      ['', D, 'x'],
      [`a\u0000b`, D, 'x'],
      [H, 'dim:x', 'x'],
      [H, D, ''],
      [H, D, 'a'.repeat(65)],
      [H, D, 'no spaces'],
      [H, D, 42],
      [null, D, 'x'],
    ] as const)
      expect(dimOpOid(h, d, o)).toBeNull();
    expect(DIM_OP_ID_PATTERN.test('A-z_09')).toBe(true);
  });
});

describe('dimRowBy', () => {
  it('reads the hand of a row the way the fold does, bounded as the view shows it', () => {
    const p = 'p:00000000/s-zzzzzzzzzzzzzzza';
    expect(dimRowBy({ seq: 1, kind: 'k', payload: { relayedFor: { principal: p, surface: 'bridge', agent: 'claude' } } })).toEqual({ cls: 'agent', principal: p, agent: 'claude' });
    expect(dimRowBy({ seq: 1, kind: 'k', payload: { relayedFor: { principal: 'p:00000000/founder', surface: 'gui' } } })).toEqual({ cls: 'human', principal: 'p:00000000/founder' });
    expect(dimRowBy({ seq: 1, kind: 'k', payload: { relayedFor: { principal: p, surface: 'bridge', agent: 'bad label!' } } }).cls).toBe('unknown');
    expect(dimRowBy({ seq: 1, kind: 'k', payload: {} }).cls).toBe('unknown');
    expect(dimRowBy(null as never).cls).toBe('unknown');
  });
});

describe('a session principal as the kernel builds it matches DIM_VIEW_PRINCIPAL_PATTERN', () => {
  it('`${ns}/s-${hsidShort(hsid)}` (supervisor #principalFor) is accepted by the tools and the view', () => {
    // a format change on either side fails here, not when an agent first draws
    for (const ns of ['00000000', 'zzzzzzzz', 'abcdefgh', '7k3m9pqr']) {
      expect(NS_PATTERN.test(ns)).toBe(true);
      for (let i = 0; i < 20; i++) {
        const principal = principalId(ns, `s-${hsidShort(mintHsid())}`);
        expect([principal, DIM_VIEW_PRINCIPAL_PATTERN.test(principal)]).toEqual([principal, true]);
      }
    }
  });
});

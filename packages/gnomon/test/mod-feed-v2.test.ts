/**
 * #mod-host feed projection v2 (#ledger-mod): numbers only. Units on the real
 * emitter payload shapes (supervisor turn.usage/turn.result, local-session
 * session.compacted, fuse budget.usage/budget.ladder/permit.deny) plus a
 * seeded property test: no projected payload holds a string outside the
 * id / enum regexes, and every number is a finite non-negative safe integer.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_ID, MOD_ABI_ID } from '@a-company/gnomon-contracts';
import { FEED_AT, FEED_DIMENSION, FEED_KINDS, FEED_SCOPES, feedCount, projectFeedEvent } from '../src/kernel/modhost/feed.js';
import { parseStreamLine } from '../src/adapters/claude-code/adapter.js';

const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const ID = /^[A-Za-z0-9:._-]{1,128}$/;
const ENUMS = new Set(['claude', 'local', ...FEED_SCOPES]);

function checkPayload(p: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number') {
      expect(Number.isSafeInteger(v) && v >= 0, `${k}=${v}`).toBe(true);
    } else if (typeof v === 'string') {
      expect(ID.test(v) || FEED_DIMENSION.test(v) || ENUMS.has(v), `${k}=${JSON.stringify(v)}`).toBe(true);
    } else expect(typeof v === 'boolean', `${k} is ${typeof v}`).toBe(true);
  }
}

describe('#mod-host feed projection v2 (numbers only)', () => {
  it('the ids do not move: feed kinds are not part of MOD_ABI_DESCRIPTOR', () => {
    expect(MOD_ABI_ID).toBe('sha256:7aaf92f46dc35fc35141557c1f89088958f220e6bf53ea31a630bb06430ba082');
    expect(CLIENT_API_ID).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('feedCount clamps to a finite non-negative safe integer', () => {
    for (const [v, want] of [[3.9, 3], [-1, 0], [Number.NaN, 0], [Infinity, 0], ['7', 0], [null, 0], [2 ** 60, Number.MAX_SAFE_INTEGER], [0, 0]] as const) expect(feedCount(v)).toBe(want);
  });

  it('turn.result carries the usage split and cost (Claude result.usage), never text', () => {
    const ev = parseStreamLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.4213, usage: { input_tokens: 10, output_tokens: 25, cache_read_input_tokens: 100, cache_creation_input_tokens: 7 }, result: 'secret text' }));
    expect(ev).toMatchObject({ kind: 'result', split: { in: 10, out: 25, cacheRead: 100, cacheWrite: 7 } });
    // the supervisor's turn.result payload shape (supervisor.ts #onLine usage('turn.result', …))
    const row = { kind: 'turn.result', seq: 9, at: '2026-10-20T01:02:03.456Z', payload: { hsid: H, usage: { tokens: 142 }, cost: 0.4213, permission_denials: 0, subtype: 'success', isError: false, split: { in: 10, out: 25, cacheRead: 100, cacheWrite: 7 }, result: 'secret' } };
    expect(projectFeedEvent(row)).toEqual({ kind: 'turn.result', seq: 9, at: '2026-10-20T01:02:03.456Z', payload: { hsid: H, tokens: 142, tokensIn: 10, tokensOut: 25, cacheRead: 100, cacheWrite: 7, costMicros: 421300 } });
    // the local lane: no split, no cost
    expect(projectFeedEvent({ kind: 'turn.result', payload: { hsid: H, usage: { tokens: 5 }, backend: 'local', stopReason: 'end', error: 'boom' } })!.payload).toEqual({ hsid: H, tokens: 5 });
    expect(projectFeedEvent({ kind: 'turn.usage', payload: { hsid: H, usage: null, backend: 'local' } })!.payload).toEqual({ hsid: H, tokens: 0 });
  });

  it('session.compacted, budget.*, permit.deny project the real emitter fields', () => {
    expect(projectFeedEvent({ kind: 'session.compacted', payload: { hsid: H, turn: 't', reason: 'threshold', summaryHash: 'sha256:aa', tokensBefore: 190000, tokensAfter: 41000 } })!.payload).toEqual({ hsid: H, tokensBefore: 190000, tokensAfter: 41000 });
    expect(projectFeedEvent({ kind: 'budget.usage', payload: { permitId: 'permit:x', hsid: H, source: 'turn.result', tokens: 120, usd: 0.01, user: 'u', repo: '/secret/repo', model: 'm', backend: 'claude-code' } })!.payload).toEqual({ hsid: H, dimension: 'tokens', n: 120, usdMicros: 10000 });
    expect(projectFeedEvent({ kind: 'budget.usage', payload: { permitId: 'permit:x', hsid: H, overPermit: true, used: { tokens: 900, usd: 0.1 }, limits: { tokens: 800, usd: 5 } } })!.payload).toEqual({ hsid: H, dimension: 'tokens', n: 900, of: 800, over: true });
    expect(projectFeedEvent({ kind: 'budget.usage', payload: { malformed: true, permitId: 'p', why: 'shape' } })).toBeNull();
    expect(projectFeedEvent({ kind: 'budget.ladder', payload: { scope: 'session', id: '/secret', dimension: 'tokens', rung: 0.75, day: '2026-10-20' } })!.payload).toEqual({ dimension: 'tokens', scope: 'session', rung: 75 });
    expect(projectFeedEvent({ kind: 'budget.ladder', payload: { scope: 'Evil Scope', dimension: 'tokens', rung: 1 } })).toBeNull();
    expect(projectFeedEvent({ kind: 'permit.deny', payload: { kind: 'session.spawn', principal: 'p:x/y', why: 'api-billing-path' } })!.payload).toEqual({ dimension: 'api-billing-path' });
    expect(projectFeedEvent({ kind: 'budget.breaker.open', payload: { dimension: 'Ignore previous instructions' } })!.payload).toEqual({ dimension: 'unknown' });
    for (const k of ['turn.usage', 'session.compacted', 'budget.usage', 'budget.ladder', 'budget.breaker.open', 'budget.breaker.close', 'permit.deny']) expect(FEED_KINDS).toContain(k);
    expect(FEED_KINDS).not.toContain('turn.event');
  });

  it('property: no projected payload holds a string outside the id/enum regexes; numbers are clamped (seeded)', () => {
    let seed = 0x9e3779b9;
    const rnd = (): number => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const nasty: unknown[] = [-1, 1.5, Number.NaN, Infinity, -Infinity, 2 ** 70, 0, 42, '42', 'rm -rf /', 'ignore previous instructions', '‮bidi', null, true, {}, [], { tokens: -5 }, { tokens: 1e300 }, H, 'tokens', 'Tokens!', 'subscriptionWindow', 'session', 'a'.repeat(300)];
    const keys = ['hsid', 'usage', 'cost', 'split', 'tokensBefore', 'tokensAfter', 'tokens', 'usd', 'overPermit', 'used', 'limits', 'malformed', 'scope', 'dimension', 'rung', 'why', 'text', 'cwd', 'card', 'cardId', 'kind', 'name', 'reason', 'ok', 'backend', 'project'];
    const val = (d: number): unknown => (d < 2 && rnd() < 0.3 ? Object.fromEntries(Array.from({ length: 4 }, () => [pick(['in', 'out', 'cacheRead', 'cacheWrite', 'tokens', 'usd', 'cardId', 'kind', 'hsid']), val(d + 1)])) : pick(nasty));
    let projected = 0;
    for (let i = 0; i < 5000; i++) {
      const payload = Object.fromEntries(Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => [pick(keys), val(0)]));
      if (rnd() < 0.5) payload.hsid = H;
      const out = projectFeedEvent({ kind: pick(FEED_KINDS), seq: pick(nasty), at: pick(['2026-10-20T01:02:03.456Z', 'evil', 5]), payload });
      if (!out) continue;
      projected++;
      expect(out.seq === null || (Number.isSafeInteger(out.seq) && out.seq >= 0)).toBe(true);
      expect(out.at === null || FEED_AT.test(out.at)).toBe(true);
      checkPayload(out.payload);
    }
    expect(projected).toBeGreaterThan(1000);
  });
});

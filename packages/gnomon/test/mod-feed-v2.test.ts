/**
 * #mod-host feed projection v2 (#ledger-mod): numbers only. Units on the real
 * emitter payload shapes (supervisor turn.usage/turn.result, local-session
 * session.compacted, fuse budget.usage/budget.ladder/permit.deny) plus a
 * seeded property test: no projected payload holds a string outside the
 * id / enum regexes, and every number is a finite non-negative safe integer.
 */
import { describe, expect, it } from 'vitest';
import { CLIENT_API_ID, MOD_ABI_ID } from '@a-company/gnomon-contracts';
import { FEED_AT, FEED_DIMENSION, FEED_KINDS, FEED_SCOPES, FEED_USAGE_KINDS, feedAccessOf, feedCount, feedReaches, projectFeedEvent } from '../src/kernel/modhost/feed.js';
import { validateManifest } from '../src/kernel/manifest/manifest.js';

const U = { usage: true };
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
    expect(projectFeedEvent(row, U)).toEqual({ kind: 'turn.result', seq: 9, at: '2026-10-20T01:02:03.456Z', payload: { hsid: H, tokens: 142, tokensIn: 10, tokensOut: 25, cacheRead: 100, cacheWrite: 7, costMicros: 421300 } });
    // the local lane: no split, no cost
    expect(projectFeedEvent({ kind: 'turn.result', payload: { hsid: H, usage: { tokens: 5 }, backend: 'local', stopReason: 'end', error: 'boom' } }, U)!.payload).toEqual({ hsid: H, tokens: 5 });
    expect(projectFeedEvent({ kind: 'turn.usage', payload: { hsid: H, usage: null, backend: 'local' } }, U)!.payload).toEqual({ hsid: H, tokens: 0 });
  });

  it('session.compacted, budget.*, permit.deny project the real emitter fields', () => {
    expect(projectFeedEvent({ kind: 'session.compacted', payload: { hsid: H, turn: 't', reason: 'threshold', summaryHash: 'sha256:aa', tokensBefore: 190000, tokensAfter: 41000 } }, U)!.payload).toEqual({ hsid: H, tokensBefore: 190000, tokensAfter: 41000 });
    expect(projectFeedEvent({ kind: 'budget.usage', payload: { permitId: 'permit:x', hsid: H, source: 'turn.result', tokens: 120, usd: 0.01, user: 'u', repo: '/secret/repo', model: 'm', backend: 'claude-code' } }, U)!.payload).toEqual({ hsid: H, dimension: 'tokens', n: 120, usdMicros: 10000 });
    expect(projectFeedEvent({ kind: 'budget.usage', payload: { permitId: 'permit:x', hsid: H, overPermit: true, used: { tokens: 900, usd: 0.1 }, limits: { tokens: 800, usd: 5 } } }, U)!.payload).toEqual({ hsid: H, dimension: 'tokens', n: 900, of: 800, over: true });
    expect(projectFeedEvent({ kind: 'budget.usage', payload: { malformed: true, permitId: 'p', why: 'shape' } }, U)).toBeNull();
    expect(projectFeedEvent({ kind: 'budget.ladder', payload: { scope: 'session', id: '/secret', dimension: 'tokens', rung: 0.75, day: '2026-10-20' } }, U)!.payload).toEqual({ dimension: 'tokens', scope: 'session', rung: 75 });
    expect(projectFeedEvent({ kind: 'budget.ladder', payload: { scope: 'Evil Scope', dimension: 'tokens', rung: 1 } }, U)).toBeNull();
    expect(projectFeedEvent({ kind: 'permit.deny', payload: { kind: 'session.spawn', principal: 'p:x/y', why: 'api-billing-path' } }, U)!.payload).toEqual({ dimension: 'api-billing-path' });
    expect(projectFeedEvent({ kind: 'budget.breaker.open', payload: { dimension: 'Ignore previous instructions' } }, U)!.payload).toEqual({ dimension: 'unknown' });
    for (const k of ['turn.usage', 'session.compacted', 'budget.usage', 'budget.ladder', 'budget.breaker.open', 'budget.breaker.close', 'permit.deny']) expect(FEED_KINDS).toContain(k);
    expect(FEED_KINDS).not.toContain('turn.event');
  });

  it('Aegis L2: usageSplit floors and clamps at the source; the logged split equals its projection', () => {
    const ev = parseStreamLine(JSON.stringify({ type: 'result', usage: { input_tokens: 10.9, output_tokens: -3, cache_read_input_tokens: 1e300, cache_creation_input_tokens: 'x' } }));
    const split = (ev as { split: Record<string, number> }).split;
    expect(split).toEqual({ in: 10, out: 0, cacheRead: Number.MAX_SAFE_INTEGER, cacheWrite: 0 });
    const p = projectFeedEvent({ kind: 'turn.result', payload: { hsid: H, usage: { tokens: 1 }, split } }, U)!.payload;
    expect([p.tokensIn, p.tokensOut, p.cacheRead, p.cacheWrite]).toEqual([split.in, split.out, split.cacheRead, split.cacheWrite]);
  });

  it('Aegis M1: without log.read:usage a mod gets no usage kind and turn.result is {hsid} only', () => {
    const row = { kind: 'turn.result', payload: { hsid: H, usage: { tokens: 142 }, cost: 0.42, split: { in: 1, out: 2, cacheRead: 3, cacheWrite: 4 } } };
    expect(projectFeedEvent(row)!.payload).toEqual({ hsid: H });
    for (const kind of FEED_USAGE_KINDS) expect(projectFeedEvent({ kind, payload: { hsid: H, dimension: 'tokens', scope: 'session', rung: 1, tokens: 5 } }), kind).toBeNull();
    const v1 = feedAccessOf(['log.read']);
    const usage = feedAccessOf(['log.read', 'log.read:usage']);
    const none = feedAccessOf(['state.get']);
    for (const kind of FEED_USAGE_KINDS) {
      expect(feedReaches(v1, kind)).toBe(false);
      expect(feedReaches(usage, kind)).toBe(true);
    }
    expect(feedReaches(v1, 'turn.result')).toBe(true);
    expect(feedReaches(v1, 'session.open')).toBe(true);
    expect(feedReaches(none, 'session.open')).toBe(false);
    expect(feedReaches(feedAccessOf(['log.read:usage']), 'session.open')).toBe(false);
  });

  it('Aegis M1: a local-tier mod may not combine log.read:usage with egress (first-party may; no egress is fine)', () => {
    const m = (caps: string[], egress: unknown) => ({ manifest: 2, publisher: 'acme', kind: 'mod', name: 'meter', version: '1.0.0', abi: 'mod-abi:v1', provides: { views: [{ id: 'meter.v', slot: 'panel', placement: 'append' }] }, requires: { capabilities: caps, egress } });
    const net = [{ host: 'example.com', purpose: 'upload' }];
    expect(() => validateManifest(m(['log.read', 'log.read:usage'], net), { tier: 'local' })).toThrow(/log.read:usage cannot list egress/);
    expect(() => validateManifest(m(['log.read', 'log.read:usage'], 'none'), { tier: 'local' })).not.toThrow();
    expect(() => validateManifest(m(['log.read'], net), { tier: 'local' })).not.toThrow();
    expect(() => validateManifest({ ...m(['log.read', 'log.read:usage'], net), publisher: 'gnomon' }, { tier: 'first-party' })).not.toThrow();
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
      const out = projectFeedEvent({ kind: pick(FEED_KINDS), seq: pick(nasty), at: pick(['2026-10-20T01:02:03.456Z', 'evil', 5]), payload }, rnd() < 0.5 ? U : {});
      if (!out) continue;
      projected++;
      expect(out.seq === null || (Number.isSafeInteger(out.seq) && out.seq >= 0)).toBe(true);
      expect(out.at === null || FEED_AT.test(out.at)).toBe(true);
      checkPayload(out.payload);
    }
    expect(projected).toBeGreaterThan(1000);
  });
});

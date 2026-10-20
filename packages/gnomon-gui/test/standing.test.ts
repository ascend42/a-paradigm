/**
 * #gui standing-grant feed (TD-2026-10-20-086 F6): the pure core (core/standing.ts) and the page wiring read from
 * the source (ui/standing-feed.ts is browser glue; its decisions are the pure functions tested here).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dayKey, feedItemOf, KERNEL_PRINCIPAL, grantRequest, revokeRequest, shouldOffer, STANDING_TUPLES, standingStatusOf } from '../src/core/standing.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const G = 'card:01HZZZZZZZZZZZZZZZZZZZZZZG';
const REPO = `sha256:${'a'.repeat(64)}`;
const live = { standing: { built: true, active: [{ grantId: G, tuples: ['permission:always'], repos: [REPO], expiresAt: '2026-10-20T21:00:00.000Z', uses: 2 }] } };

describe('standing feed: status and rows', () => {
  it('status.standing is read fail-safe: anything unreadable is no grant', () => {
    expect(standingStatusOf(live)).toMatchObject({ built: true, active: [{ grantId: G, uses: 2 }] });
    expect(standingStatusOf({})).toEqual({ built: false, active: [], pendingCardId: null });
    expect(standingStatusOf({ standing: { built: true, active: [{ grantId: 1 }] } }).active).toEqual([]);
  });
  it('only KERNEL rows feed it (Aegis #12): a row from any other principal, or none, is ignored', () => {
    const used = { seq: 5, kind: 'grant.standing.used', payload: { grantId: G, tuple: 'permission:always' } };
    expect(feedItemOf({ ...used, principal: 'p:abcdefgh/kernel' })).not.toBeNull();
    expect(feedItemOf({ ...used, principal: 'p:abcdefgh/s-01hzzzzz' })).toBeNull();
    expect(feedItemOf({ ...used, principal: 'p:abcdefgh/kernelx' })).toBeNull();
    expect(feedItemOf(used)).toBeNull();
    expect(KERNEL_PRINCIPAL.test('p:abcdefgh/kernel')).toBe(true);
  });
  it('Aegis M1: a joined row is a toast: "another Gnomon window joined your unlock"', () => {
    expect(feedItemOf({ seq: 9, kind: 'approval.unlock.joined', principal: 'p:abcdefgh/kernel', payload: { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZB', scope: 'device' } })).toMatchObject({ kind: 'joined', toast: true, text: expect.stringContaining('Another Gnomon window joined your unlock') });
  });
  it('a use row is a toast and a feed line naming what was done; minted and revoked rows are feed lines', () => {
    expect(feedItemOf({ principal: 'p:abcdefgh/kernel', seq: 5, kind: 'grant.standing.used', payload: { grantId: G, tuple: 'mode.loosen:auto-edits', decision: 'allow', repo: REPO, hsid: null } })).toMatchObject({ kind: 'used', toast: true, text: expect.stringContaining('switched a folder to auto-edits') });
    expect(feedItemOf({ principal: 'p:abcdefgh/kernel', seq: 6, kind: 'grant.standing.revoked', payload: { grantId: G, reason: 'screen-lock' } })).toMatchObject({ kind: 'revoked', toast: false, text: expect.stringContaining('screen-lock') });
    expect(feedItemOf({ seq: 7, kind: 'approval.decide', payload: { grantId: G } })).toBeNull();
  });
});

describe('standing feed: the once-a-day offer', () => {
  const v = (active = false, pending: string | null = null) => ({ built: true, active: active ? standingStatusOf(live).active : [], pendingCardId: pending });
  it('offered at the first presence-needing card of the day with no live grant, never twice a day', () => {
    expect(shouldOffer(['strictness'], v(), null, '2026-10-20')).toBe(true);
    expect(shouldOffer(['permission'], v(), '2026-10-19', '2026-10-20')).toBe(true);
    expect(shouldOffer(['strictness'], v(), '2026-10-20', '2026-10-20')).toBe(false);
    expect(shouldOffer(['strictness'], v(true), null, '2026-10-20')).toBe(false);
    expect(shouldOffer(['strictness'], v(false, 'card:x'), null, '2026-10-20')).toBe(false);
    expect(shouldOffer(['gate-class', 'install', 'fallback'], v(), null, '2026-10-20')).toBe(false); // never-standing kinds never offer
    expect(shouldOffer(['strictness'], { ...v(), built: false }, null, '2026-10-20')).toBe(false); // an older kernel
    expect(dayKey(new Date(2026, 9, 20, 23, 59))).toBe('2026-10-20');
  });
  it('the requests: every tuple for the focused repo; revoke by grantId', () => {
    expect(grantRequest(REPO)).toEqual({ kind: 'request.grant.standing', payload: { tuples: [...STANDING_TUPLES], repos: [REPO] } });
    expect(grantRequest(null).payload.repos).toEqual([]);
    expect(revokeRequest(G)).toEqual({ kind: 'request.grant.standing.revoke', payload: { grantId: G } });
  });
});

describe('standing feed: the page wiring (source read)', () => {
  const feed = readFileSync(path.join(ROOT, 'src', 'ui', 'standing-feed.ts'), 'utf8');
  const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
  it('offer and Revoke send only on a trusted gesture; the grant card is approved in the same gesture', () => {
    expect(feed).toMatch(/offer\.addEventListener\('click', \(e\) => \{\s*if \(!e\.isTrusted/);
    expect(feed).toMatch(/revoke\.addEventListener\('click', \(e\) => \{[\s\S]{0,80}if \(!e\.isTrusted/);
    expect(feed).toMatch(/'log\.append', grantRequest\([\s\S]{0,200}client|c\.call\('approve', \{ cardId: r\.cardId, decision: 'allow' \}\)/);
  });
  it('app.ts mounts the module once and forwards live rows and status reads (a minimal mount)', () => {
    expect(app.match(/mountStandingFeed\(/g)).toHaveLength(1);
    expect(app).toContain('standingFeed.row(r);');
    expect(app).toContain('standingFeed.repaint();');
  });
});

/**
 * #offer-router `gnomon desk stats` (T-2026-10-21-006, founder ruling): offer.suppressed on the signed log is accepted
 * by verifyLog and folded per mod (shown N · suppressed M, by reason) and, when it names no mod, per session.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { foldDeskStats, foldDeskUnnamed } from '../src/cli/desk-cli.js';
import { KernelLog, KeyRing, SoftwareEd25519Signer, verifyLog } from '../src/kernel/log/index.js';
import { HSID, HSID2, KERNEL } from './desk-fixtures.js';

const parents: string[] = [];
afterEach(() => {
  for (const p of parents.splice(0)) rmSync(p, { recursive: true, force: true });
});

const MOD = 'acme.constellation';
const T = (h: string, n: number) => `turn:${h}/${n}`;
const OFFER = 'offer:01J00000000000000000000001';
const ROWS: Array<{ kind: string; payload: Record<string, unknown> }> = [
  { kind: 'offer.shown', payload: { offerId: OFFER, hsid: HSID, mod: MOD, kind: 'map-the-idea', phase: 'diverge', title: 'Map it', contextIn: ['recent-messages'], question: 'Map this?', replyTurnId: T(HSID, 1) } },
  { kind: 'offer.suppressed', payload: { hsid: HSID, turn: T(HSID, 2), why: 'pending-card', name: MOD, offerKind: 'map-the-idea' } },
  { kind: 'offer.suppressed', payload: { hsid: HSID, turn: T(HSID, 3), why: 'turn-streaming', name: MOD, offerKind: 'map-the-idea' } },
  { kind: 'offer.suppressed', payload: { hsid: HSID, turn: T(HSID, 4), why: 'pending-card', name: MOD, offerKind: 'pull-together' } },
  { kind: 'offer.suppressed', payload: { hsid: HSID, turn: T(HSID, 5), why: 'no-block' } },
  { kind: 'offer.suppressed', payload: { hsid: HSID, turn: T(HSID, 6), why: 'no-block' } },
  { kind: 'offer.suppressed', payload: { hsid: HSID2, turn: T(HSID2, 1), why: 'malformed' } },
];

describe('gnomon desk stats: offer.suppressed', () => {
  it('per mod: shown N · suppressed M with a per-reason breakdown', () => {
    expect(foldDeskStats(ROWS)[MOD]).toEqual({ shown: 1, open: 0, notNow: 0, stopHere: 0, kept: 0, suppressed: 3, suppressedBy: { 'pending-card': 2, 'turn-streaming': 1 } });
  });
  it('no-block and malformed name no mod: counted per session, never under a mod', () => {
    expect(Object.keys(foldDeskStats(ROWS))).toEqual([MOD]);
    expect(foldDeskUnnamed(ROWS)).toEqual({ byReason: { 'no-block': 2, malformed: 1 }, bySession: { [HSID]: { 'no-block': 2 }, [HSID2]: { malformed: 1 } } });
  });
  it('verifyLog accepts kernel-signed offer.suppressed rows (replay reads them)', async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'gnomon-desk-stats-'));
    parents.push(parent);
    const home = path.join(parent, '.gnomon');
    mkdirSync(home, { mode: 0o700 });
    const signer = SoftwareEd25519Signer.generate();
    const log = KernelLog.open({ home, kernelPrincipal: KERNEL, signer });
    for (const r of ROWS) await log.append({ kind: r.kind, principal: KERNEL, payload: { ...r.payload }, session: r.payload.hsid as string });
    // a payload outside the closed check (message text) is refused at append
    await expect(log.append({ kind: 'offer.suppressed', principal: KERNEL, payload: { hsid: HSID, turn: T(HSID, 9), why: 'no-block', text: 'hello' }, session: HSID })).rejects.toThrow();
    await log.close();
    const ring = new KeyRing();
    ring.addEd25519(signer.publicKeyPem);
    const seen: Array<{ kind: string; payload: unknown }> = [];
    const report = verifyLog(home, {
      keyRing: ring,
      kernelPrincipal: KERNEL,
      kernelKeyIds: [signer.keyId],
      onRow: (r) => {
        if (r.kind.startsWith('offer.')) seen.push({ kind: r.kind, payload: (JSON.parse(r.envelope) as { payload?: unknown }).payload });
      },
    });
    expect(report.ok).toBe(true);
    expect(seen.filter((r) => r.kind === 'offer.suppressed')).toHaveLength(6);
    expect(foldDeskStats(seen)[MOD]!.suppressed).toBe(3);
  });
  it('review C2: only the kernel principal\'s offer.shown / offer.suppressed rows count', () => {
    const rows = [...ROWS.map((r) => ({ ...r, principal: KERNEL })), { ...ROWS[0]!, payload: { ...ROWS[0]!.payload, offerId: 'offer:01J00000000000000000000002' }, principal: 'p:agent/claude' }, { ...ROWS[1]!, principal: 'p:agent/claude' }, { ...ROWS[4]!, principal: 'p:agent/claude' }];
    expect(foldDeskStats(rows, { kernelPrincipal: KERNEL })[MOD]).toMatchObject({ shown: 1, suppressed: 3 });
    expect(foldDeskUnnamed(rows, { kernelPrincipal: KERNEL }).byReason).toEqual({ 'no-block': 2, malformed: 1 });
  });

});

/**
 * #ledger-mod (packages/gnomon-mods/ledger): the context and budget meter.
 * Model units (pure reducer + render, clamps, bounds, unknown kinds ignored)
 * and the fixture goldens rendered through a real ModHost after `gnomon mod
 * install` + the broker card (light and dark theme, full and reduced motion).
 * State comes ONLY from the #mod-host numbers-only feed (projection v2).
 * Platform-independent like test/workshop-mod.test.ts (LF-pinned tree, plain
 * node children, no POSIX mode asserted).
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { MOD_ABI_ID } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { effectiveInstall, readGrants, removeTree } from '../src/kernel/manifest/index.js';
import { FIRST_PARTY_PACKAGE_HASHES } from '../src/kernel/manifest/install.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { StagedCardPickup } from '../src/kernel/modhost/control.js';
import type { ModHost } from '../src/kernel/modhost/host.js';
import { sanitizeModBlock } from '../src/kernel/modhost/block.js';
import { createModHostForTest, mintTestPresence, unsandboxedModLauncher } from '../src/kernel/testing.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const LEDGER = path.resolve(PKG_ROOT, '..', 'gnomon-mods', 'ledger');
const HUMAN = 'p:abcdefgh/matt';
const H = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
const FIXTURES = ['strip', 'strip-reduced', 'over-budget', 'breaker', 'compacted'];
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type Model = {
  MAX_SESSIONS: number;
  emptyState(): { sessions: Map<string, Record<string, unknown>>; ladder: Map<string, number>; breakers: Set<string>; denies: Map<string, number>; permit: unknown };
  apply(s: unknown, e: unknown): unknown;
  count(v: unknown): number;
  short(n: number): string;
  summaryLine(t: unknown): string;
  totals(s: unknown, hsid: string | null): Record<string, unknown>;
  budgetTone(s: unknown): string;
  renderStrip(s: unknown, prefs?: unknown, input?: unknown): Record<string, unknown>;
  renderSheet(s: unknown, prefs?: unknown): Record<string, unknown>;
  VIEWS: Record<string, (s: unknown, prefs?: unknown, input?: unknown) => Record<string, unknown>>;
};
const model = (await import(pathToFileURL(path.join(LEDGER, 'model.mjs')).href)) as Model;
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(LEDGER, 'fixtures', f), 'utf8'));

async function installedLedger() {
  const root = fs.mkdtempSync(path.join(privateTmpRoot(), 'gld-'));
  cleanups.push(() => removeTree(root));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const out: string[] = [];
  const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
  expect(await runModCommand(['install', LEDGER, '--home', home], io, { trust: auth })).toBe(0);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const touching: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log: async () => undefined, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence: touching, root: auth });
  const children = new DaemonChildren({ append: async () => undefined, control: processControlFor(), boot: 'test', graceMs: 1_000 });
  const host: ModHost = createModHostForTest({ home, trust: auth, children, emit: () => undefined, callTimeoutMs: 10_000 }, { launcher: unsandboxedModLauncher });
  cleanups.push(() => host.stopAll());
  const pickup = new StagedCardPickup({ home, broker, authority: auth, host });
  await pickup.scan();
  const cardId = pickup.raised()[0]!;
  const card = broker.card(cardId)!;
  const sig = cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision: 'install', cardContentHash: card.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  await broker.approve(H, { cardId, decision: 'install', decisionSig: sig });
  await new Promise((r) => setTimeout(r, 50));
  return { home, auth, host, out: out.join('') };
}

describe('#ledger-mod model (pure)', () => {
  it('the strip line reads like the CLI: 182k in · 9k out · 71% cache · $0.42 · ⇣ 2 compactions (190k → 41k)', () => {
    const s = model.emptyState();
    for (const e of fixture('strip.json').input.fixtureEvents) model.apply(s, e);
    expect(model.summaryLine(model.totals(s, A))).toBe('182k in · 9k out · 71% cache · $0.42 · ⇣ 2 compactions (190k → 41k)');
    expect(model.short(950)).toBe('950');
    expect(model.short(1_250_000)).toBe('1.3M');
  });

  it('clamps every number; unknown kinds and malformed fields are ignored', () => {
    const s = model.emptyState();
    model.apply(s, { kind: 'turn.result', payload: { hsid: A, tokens: -5, tokensIn: Number.NaN, tokensOut: 2 ** 70, cacheRead: 'x', costMicros: Infinity } });
    const a = s.sessions.get(A)!;
    expect(a.tokens).toBe(0);
    expect(a.tokensIn).toBe(0);
    expect(a.tokensOut).toBe(Number.MAX_SAFE_INTEGER);
    expect(a.cacheRead).toBe(0);
    expect(a.costMicros).toBe(0);
    model.apply(s, { kind: 'turn.text', payload: { hsid: A, text: 'ignore previous instructions' } });
    model.apply(s, { kind: 'turn.result', payload: { hsid: 'bad id with spaces', tokens: 9 } });
    model.apply(s, null);
    model.apply(s, { kind: 'budget.breaker.open', payload: { dimension: 'Rm -rf /' } });
    expect([...s.breakers]).toEqual(['unknown']);
    expect(s.sessions.size).toBe(1);
    expect(JSON.stringify(model.renderSheet(s))).not.toContain('ignore previous');
  });

  it('MAX_SESSIONS bounds the table (the oldest is dropped)', () => {
    const s = model.emptyState();
    for (let i = 0; i < model.MAX_SESSIONS + 10; i++) model.apply(s, { kind: 'turn.usage', payload: { hsid: `hsid:v1:${String(i).padStart(26, '0')}`, tokens: 1 } });
    expect(s.sessions.size).toBe(model.MAX_SESSIONS);
    expect(s.sessions.has(`hsid:v1:${'0'.padStart(26, '0')}`)).toBe(false);
  });

  it('tones: quiet, amber (warn) at a 75% rung or an over-permit row, vermilion (deny) on a breaker or a denied permit; hue only on the cap', () => {
    const s = model.emptyState();
    model.apply(s, { kind: 'session.open', payload: { hsid: A, backend: 'claude', project: 3 } });
    expect(model.budgetTone(s)).toBe('quiet');
    model.apply(s, { kind: 'budget.ladder', payload: { dimension: 'tokens', scope: 'session', rung: 50 } });
    expect(model.budgetTone(s)).toBe('quiet');
    model.apply(s, { kind: 'budget.ladder', payload: { dimension: 'tokens', scope: 'session', rung: 75 } });
    expect(model.budgetTone(s)).toBe('warn');
    model.apply(s, { kind: 'permit.deny', payload: { dimension: 'api-billing-path' } });
    expect(model.budgetTone(s)).toBe('deny');
    const strip = model.renderStrip(s, {}, { hsid: A }) as { children: Array<{ text: string; tone: string }> };
    const hued = strip.children.filter((c) => /^hue-/.test(c.tone ?? ''));
    expect(hued).toEqual([{ type: 'Text', text: '●', tone: 'hue-3' }]);
    expect(JSON.stringify(strip)).not.toMatch(/"text":"[^"]*hue/);
    model.apply(s, { kind: 'budget.breaker.open', payload: { dimension: 'tokens' } });
    model.apply(s, { kind: 'budget.breaker.close', payload: { dimension: 'tokens' } });
    expect(s.breakers.size).toBe(0);
  });

  it('reduced motion renders the meter as text (no Progress fill at all)', () => {
    const fx = fixture('strip-reduced.json');
    const s = model.emptyState();
    for (const e of fx.input.fixtureEvents) model.apply(s, e);
    expect(JSON.stringify(model.renderStrip(s, { motion: 'reduced' }, { hsid: A }))).not.toContain('Progress');
    expect(JSON.stringify(model.renderStrip(s, { motion: 'full' }, { hsid: A }))).toContain('"type":"Progress"');
  });

  it('every golden is a kit:v1 block the host gate accepts unchanged, the same in light and dark', () => {
    for (const f of FIXTURES) {
      const fx = fixture(`${f}.json`);
      const golden = fixture(`${f}.golden.json`);
      expect(sanitizeModBlock(golden, 'ledger').block).toEqual(golden);
      for (const theme of ['day', 'night']) {
        const s = model.emptyState();
        for (const e of fx.input.fixtureEvents) model.apply(s, e);
        expect({ schemaVersion: 'display-block:v1', ...model.VIEWS[fx.view]!(s, { ...fx.prefs, theme }, { hsid: fx.input.hsid }) }, `${f} ${theme}`).toEqual(golden);
      }
    }
  });
});

describe('#ledger-mod through the host', () => {
  it('its packageHash is the pinned first-party hash (an edit to the package is a new install card)', () => {
    const h = hashSourceTree(LEDGER, 'ledger', () => undefined).packageHash;
    // an intended edit: `npm run repin:first-party` regenerates the goldens, then pin the hash printed here
    expect([...FIRST_PARTY_PACKAGE_HASHES], `the Ledger tree now hashes to ${h}: pin it in FIRST_PARTY_PACKAGE_HASHES (src/kernel/manifest/install.ts)`).toContain(h);
  });

  it('it echoes the current modAbiId and declares only log.read, egress none, two views in mod slots', () => {
    expect(fs.readFileSync(path.join(LEDGER, 'index.mjs'), 'utf8')).toContain(`const MOD_ABI_ID = '${MOD_ABI_ID}'`);
    const m = JSON.parse(fs.readFileSync(path.join(LEDGER, 'gnomon-manifest.json'), 'utf8'));
    expect(m.requires).toEqual({ capabilities: ['log.read'], egress: 'none' });
    expect(m.provides.views.map((v: { id: string; slot: string; placement: string }) => `${v.id}@${v.slot}:${v.placement}`)).toEqual(['ledger.strip@composer.footer:append', 'ledger.sheet@sidebar:append']);
    expect(m.provides.tools).toBeUndefined();
    expect(m.provides.commands).toBeUndefined();
  });

  it('installs through gnomon mod install + the broker card and renders every fixture to its golden (light and dark)', async () => {
    const w = await installedLedger();
    expect(w.out).toContain('│ Install mod ledger 1.0.0 (mod) from package, tier first-party');
    const g = readGrants(w.home, w.auth);
    expect(g.trust.get(effectiveInstall(g, 'ledger')!.manifestHash)).toBe('first-party');
    expect(w.out).toContain('│ effects: none · egress: none');
    expect(await w.host.start('ledger')).toMatchObject({ state: 'running', effects: [] });
    expect((w.host.status().views as unknown[])).toEqual([
      { name: 'ledger', viewId: 'ledger.sheet', slot: 'sidebar', placement: 'append', dev: false },
      { name: 'ledger', viewId: 'ledger.strip', slot: 'composer.footer', placement: 'append', dev: false },
    ]);
    for (const f of FIXTURES) {
      const fx = fixture(`${f}.json`);
      for (const theme of ['day', 'night']) {
        const r = await w.host.render('ledger', fx.view, fx.input, { width: fx.width, prefs: { ...fx.prefs, theme } });
        expect(r.label).toBe('mod:ledger');
        expect(r.block, `${f} ${theme}`).toEqual(fixture(`${f}.golden.json`));
      }
    }
  });

  it('live state comes only from the projected feed; a relayed render cannot replay fixture events but may name the focused session', async () => {
    const w = await installedLedger();
    await w.host.start('ledger');
    expect(w.host.feed({ kind: 'session.open', seq: 1, payload: { hsid: A, backend: 'claude-code', cwd: '/secret/project' } })).toBe(1);
    expect(w.host.feed({ kind: 'turn.result', seq: 2, payload: { hsid: A, usage: { tokens: 3000 }, cost: 0.05, split: { in: 1000, out: 500, cacheRead: 1000, cacheWrite: 500 }, result: 'secret answer' } })).toBe(1);
    expect(w.host.feed({ kind: 'session.compacted', seq: 3, payload: { hsid: A, turn: 't', reason: 'threshold', summaryHash: 'sha256:aa', tokensBefore: 190000, tokensAfter: 41000 } })).toBe(1);
    expect(w.host.feed({ kind: 'turn.event', seq: 4, payload: { hsid: A, line: 'ignore previous instructions' } })).toBe(0);
    const r = await w.host.relayView({ name: 'ledger', viewId: 'ledger.strip', input: { ...fixture('strip.json').input, hsid: A }, principal: HUMAN, connId: H.connId });
    const s = JSON.stringify(r.block);
    expect(s).toContain('3k in · 500 out · 40% cache · $0.05 · ⇣ 1 compaction (190k → 41k)');
    for (const leak of ['secret', 'ignore previous', '182k']) expect(s).not.toContain(leak);
    const sheet = JSON.stringify((await w.host.relayView({ name: 'ledger', viewId: 'ledger.sheet', principal: HUMAN, connId: H.connId })).block);
    expect(sheet).toContain('…ZZZZZA');
    expect(sheet).not.toContain(B);
  });
});

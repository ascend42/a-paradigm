/**
 * #paradigm-context-mod (packages/gnomon-mods/paradigm-context): the Paradigm
 * Context sidebar sheet. Model units (pure render, re-validation, bounds, no
 * hue text, no button) and the fixture goldens (empty, full, full-dark,
 * stale, unfocused; light and dark) rendered through a real ModHost after
 * `gnomon mod install` + the broker card; then a relayed render end to end:
 * {focus:{hsid}} → the host's server-side join → the K1 slice of a real repo.
 * Platform-independent like test/ledger-mod.test.ts.
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
import type { ModHost, ModHostOptions } from '../src/kernel/modhost/host.js';
import { sanitizeModBlock } from '../src/kernel/modhost/block.js';
import { createModHostForTest, mintTestPresence, unsandboxedModLauncher } from '../src/kernel/testing.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const CTX = path.resolve(PKG_ROOT, '..', 'gnomon-mods', 'paradigm-context');
const HUMAN = 'p:abcdefgh/matt';
const H = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };
const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const FIXTURES = ['empty', 'full', 'full-dark', 'stale', 'unfocused'];
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

type Model = {
  readSlice(input: unknown): Record<string, unknown> | null;
  renderSheet(input: unknown, prefs?: unknown): Record<string, unknown>;
  clip(s: unknown, max?: number): string;
  ageDays(a: string | null, b: string | null): number | null;
  VIEWS: Record<string, (input: unknown, prefs?: unknown) => Record<string, unknown>>;
  TITLE_MAX: number;
  STALE_DAYS: number;
};
const model = (await import(pathToFileURL(path.join(CTX, 'model.mjs')).href)) as Model;
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(CTX, 'fixtures', f), 'utf8'));

function nodes(b: unknown, out: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (b && typeof b === 'object') {
    out.push(b as Record<string, unknown>);
    for (const c of ((b as { children?: unknown[] }).children ?? [])) nodes(c, out);
  }
  return out;
}

async function installed(over: Partial<ModHostOptions> = {}) {
  const root = fs.mkdtempSync(path.join(privateTmpRoot(), 'gpc-'));
  cleanups.push(() => removeTree(root));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const out: string[] = [];
  const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
  expect(await runModCommand(['install', CTX, '--home', home], io, { trust: auth })).toBe(0);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const touching: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log: async () => undefined, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence: touching, root: auth });
  const children = new DaemonChildren({ append: async () => undefined, control: processControlFor(), boot: 'test', graceMs: 1_000 });
  const host: ModHost = createModHostForTest({ home, trust: auth, children, emit: () => undefined, callTimeoutMs: 10_000, ...over }, { launcher: unsandboxedModLauncher });
  cleanups.push(() => host.stopAll());
  const pickup = new StagedCardPickup({ home, broker, authority: auth, host });
  await pickup.scan();
  const cardId = pickup.raised()[0]!;
  const card = broker.card(cardId)!;
  const sig = cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision: 'install', cardContentHash: card.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  await broker.approve(H, { cardId, decision: 'install', decisionSig: sig });
  await new Promise((r) => setTimeout(r, 50));
  return { root, home, auth, host, out: out.join('') };
}

describe('#paradigm-context-mod model (pure)', () => {
  it('renders the swatch head and three zones with {n, of} counts; symbols are chips; no button, no hue text', () => {
    const b = model.renderSheet(fixture('full.json').input);
    const all = nodes(b);
    expect(all.some((n) => n.type === 'Button')).toBe(false);
    const titles = all.filter((n) => n.tone === 'head').map((n) => n.text);
    expect(titles).toEqual(['tasks · 5 of 12 open · 2 high', 'decisions · 5 of 95', 'lore · 5 of 341', 'symbols · 7']);
    // a hue tone only ever colours the one cap glyph, never a word
    for (const n of all) if (typeof n.tone === 'string' && n.tone.startsWith('hue-')) expect(n.text).toBe('●');
    const chips = all.filter((n) => n.tone === 'chip').map((n) => n.text);
    expect(chips).toEqual(['#gnomon-voice', '#gui', '$voice-turn', '#ledger-mod', '#mod-host', '^repo-hook', '#workshop-mod']);
    for (const n of all) if (n.type === 'Text') expect([...String(n.text)].length).toBeLessThanOrEqual(64 + 1 + 10 + 1 + model.TITLE_MAX + 4);
    expect(sanitizeModBlock(b, 'paradigm-context').flags).toEqual([]);
  });

  it('re-validates the slice: bad ids, oversize lists, a hue out of range, a non-symbol and a forged count are dropped or clamped', () => {
    const s = model.readSlice({
      paradigm: {
        v: 'paradigm-slice:v1', state: 'ok', project: 99, name: 'x\ny', at: '2026-10-20', newest: 'yesterday',
        tasks: { open: -4, high: 1e9, items: [...Array.from({ length: 9 }, (_, i) => ({ id: `T-${i}`, title: 't'.repeat(300), priority: 'urgent' })), { id: '../x', title: 'bad' }], count: { of: Infinity } },
        decisions: { items: 'nope' }, lore: { items: [{ id: 'L-1', title: 'ok', type: 'Not A Token' }] },
        symbols: ['#ok', '#ok', 'nope', '#Bad', '<b>'],
      },
    })!;
    expect(s.project).toBeNull();
    expect(s.name).toBe('x y');
    expect(s.newest).toBeNull();
    const t = s.tasks as { open: number; high: number; items: Array<{ title: string; priority: string }>; of: number };
    expect(t.items.length).toBe(5);
    expect(t.open).toBe(5);
    expect(t.high).toBe(5);
    expect([...t.items[0]!.title].length).toBe(model.TITLE_MAX);
    expect(t.items[0]!.priority).toBe('medium');
    expect((s.lore as { items: Array<{ type: string }> }).items[0]!.type).toBe('note');
    expect(s.symbols).toEqual(['#ok']);
    expect(model.readSlice({ paradigm: { v: 'other' } })).toBeNull();
  });

  it('stale after STALE_DAYS; unfocused and absent say so plainly', () => {
    expect(model.ageDays('2026-08-30', '2026-10-20')).toBe(51);
    expect(JSON.stringify(model.renderSheet(fixture('stale.json').input))).toContain('stale · last entry 2026-08-30 (51 days ago)');
    expect(JSON.stringify(model.renderSheet(fixture('full.json').input))).not.toContain('stale');
    expect(JSON.stringify(model.renderSheet({}))).toContain('focus a live session');
    expect(JSON.stringify(model.renderSheet({ paradigm: { v: 'paradigm-slice:v1', state: 'absent', project: 2 } }))).toContain('no .paradigm in this repo');
  });
});

describe('#paradigm-context-mod through the host', () => {
  it('its packageHash is the pinned first-party hash (an edit to the package is a new install card)', () => {
    const h = hashSourceTree(CTX, 'paradigm-context', () => undefined).packageHash;
    // an intended edit: `npm run repin:first-party` regenerates the goldens, then pin the hash printed here
    expect([...FIRST_PARTY_PACKAGE_HASHES], `the Paradigm Context tree now hashes to ${h}: pin it in FIRST_PARTY_PACKAGE_HASHES (src/kernel/manifest/install.ts)`).toContain(h);
  });

  it('installs as tier first-party', async () => {
    const w = await installed();
    expect(w.out).toContain('│ Install mod paradigm-context 1.0.0 (mod) from package, tier first-party');
    const g = readGrants(w.home, w.auth);
    expect(g.trust.get(effectiveInstall(g, 'paradigm-context')!.manifestHash)).toBe('first-party');
  });

  it('echoes the current modAbiId and declares only paradigm.read:summary, egress none, one sidebar view, no commands or tools', () => {
    expect(fs.readFileSync(path.join(CTX, 'index.mjs'), 'utf8')).toContain(`const MOD_ABI_ID = '${MOD_ABI_ID}'`);
    const m = JSON.parse(fs.readFileSync(path.join(CTX, 'gnomon-manifest.json'), 'utf8'));
    expect(m.requires).toEqual({ capabilities: ['paradigm.read:summary'], egress: 'none' });
    expect(m.provides.views.map((v: { id: string; slot: string; placement: string }) => `${v.id}@${v.slot}:${v.placement}`)).toEqual(['paradigm-context.sheet@sidebar:append']);
    expect(m.provides.tools).toBeUndefined();
    expect(m.provides.commands).toBeUndefined();
    // self-contained: it imports nothing outside its folder
    for (const f of ['index.mjs', 'model.mjs']) for (const imp of fs.readFileSync(path.join(CTX, f), 'utf8').matchAll(/from '([^']+)'/g)) expect(imp[1]).toMatch(/^\.\/[a-z-]+\.mjs$/);
  });

  it('installs through gnomon mod install + the broker card and renders every fixture to its golden (light and dark)', async () => {
    const w = await installed();
    expect(w.out).toContain('│ effects: none · egress: none');
    expect(w.out).toContain('│ capabilities: paradigm.read:summary · read paths: none');
    expect(await w.host.start('paradigm-context')).toMatchObject({ state: 'running', effects: [] });
    expect(w.host.status().views).toEqual([{ name: 'paradigm-context', viewId: 'paradigm-context.sheet', slot: 'sidebar', placement: 'append', dev: false }]);
    for (const f of FIXTURES) {
      const fx = fixture(`${f}.json`);
      for (const theme of ['day', 'night']) {
        const r = await w.host.render('paradigm-context', fx.view, fx.input, { width: fx.width, prefs: { ...fx.prefs, theme } });
        expect(r.label).toBe('mod:paradigm-context');
        expect(r.block, `${f} ${theme}`).toEqual(fixture(`${f}.golden.json`));
      }
    }
  });

  it('a relayed render: {focus:{hsid}} → the server-side join → the K1 slice of that live session repo (a forged repo is ignored)', async () => {
    const base = fs.mkdtempSync(path.join(privateTmpRoot(), 'gpr-'));
    cleanups.push(() => removeTree(base));
    const repo = path.join(base, 'shop');
    const other = path.join(base, 'other');
    for (const [r, title] of [[repo, 'Ship the cart'], [other, 'OTHER REPO']] as const) {
      fs.mkdirSync(path.join(r, '.git'), { recursive: true });
      fs.mkdirSync(path.join(r, '.paradigm', 'tasks', 'entries', '2026-10-20'), { recursive: true });
      fs.writeFileSync(path.join(r, '.paradigm', 'tasks', 'entries', '2026-10-20', 'T-2026-10-20-001.yaml'), `id: T-2026-10-20-001\nblurb: ${title}\npriority: high\nstatus: open\ncreated: '2026-10-20T01:00:00.000Z'\n`);
    }
    const w = await installed({ focusCwd: (h) => (h === A ? repo : null), userHome: path.join(base, 'nohome') });
    await w.host.start('paradigm-context');
    const r = await w.host.relayView({ name: 'paradigm-context', viewId: 'paradigm-context.sheet', input: { focus: { hsid: A }, repo: other, path: other }, principal: HUMAN, connId: H.connId });
    const s = JSON.stringify(r.block);
    expect(s).toContain('shop');
    expect(s).toContain('T-2026-10-20-001 ▲ Ship the cart');
    expect(s).toContain('tasks · 1 of 1 open · 1 high');
    expect(s).not.toContain('OTHER');
    expect(s).not.toContain(base);
    const none = JSON.stringify((await w.host.relayView({ name: 'paradigm-context', viewId: 'paradigm-context.sheet', input: { focus: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB' } }, principal: HUMAN, connId: H.connId })).block);
    expect(none).toContain('focus a live session');
  });
});

/**
 * #gui-preview (DEV ONLY): the fixture preview harness. The fixtures parse as kernel rows, the fake kernel is a
 * Transport the REAL GnomonClient connects over (serverSig and card actions verify), it answers every method app.ts
 * calls, and nothing of src/preview reaches the kernel-served bundle (G-WEB-08 pin unchanged).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { build } from 'esbuild';
import { checkCap, HSID_PATTERN, isKnownKind, validateCardV1, type LogRow } from '@a-company/gnomon-contracts';
import { describe, expect, it } from 'vitest';
import { followLog, GnomonClient, type Transport } from '../src/core/client.js';
import { verifiedDecisions } from '../src/core/server-sig.js';
import { GuiStore } from '../src/core/store.js';
import { FakeKernel, PREVIEW_MARKER, PREVIEW_METHODS, previewKey, signRows } from '../src/preview/fake-kernel.js';
import { FIXTURE_NAMES, FIXTURES } from '../src/preview/fixtures.js';
import { feedEventOf, workshopBlock } from '../src/preview/workshop.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const subtle = webcrypto.subtle as unknown as SubtleCrypto;
const ENDPOINT = 'ws://127.0.0.1:8790/rpc';

const cardsOf = (rows: readonly LogRow[]): Array<Record<string, unknown>> =>
  rows.flatMap((r) => (r.view === 'full' && r.event.kind === 'approval.request' ? [(r.event.payload as { card: Record<string, unknown> }).card] : []));

async function connected(name: string): Promise<{ client: GnomonClient; store: GuiStore; kernel: FakeKernel; key: Awaited<ReturnType<typeof previewKey>> }> {
  const fx = FIXTURES[name]!;
  const key = await previewKey(subtle);
  const kernel = new FakeKernel(fx, await signRows(fx.rows, key), key, ENDPOINT);
  const transport: Transport = kernel; // the fake IS the client's Transport (typecheck)
  const client = new GnomonClient(transport);
  const out = await client.connect({ surface: 'browser', endpointPath: ENDPOINT, verifyKey: key.spki, auth: { launchToken: 'cHJldmlldw' }, subtle });
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const store = new GuiStore();
  await followLog(client, store);
  return { client, store, kernel, key };
}

describe('#gui-preview fixtures', () => {
  it('names the fixtures the harness promises', () => {
    expect([...FIXTURE_NAMES].sort()).toEqual(['always-scopes', 'app-menu', 'choices', 'desk', 'edits-by-rule', 'empty', 'git-verbs', 'loops', 'loops-many', 'loops-none', 'loops-paused', 'loops-trust', 'loops-waiting', 'model-switch', 'model-unconfirmed', 'offer-armed', 'offer-muted', 'offer-slip', 'paradigm-context', 'settings', 'settings-day', 'spoken', 'stack-heavy', 'turn-hook', 'turn-hooks', 'turn-steps', 'voice-armed', 'voice-crashed', 'voice-input', 'voice-ladder', 'voice-mic-fault', 'voice-mic-missing', 'voice-settings', 'workshop', 'workshop-absent', 'workshop-paused']);
  });

  it.each(FIXTURE_NAMES)('%s parses as kernel rows: JSON-clean, seq 1..n, registered kinds, valid hsids and card:v1 cards', (name) => {
    const fx = FIXTURES[name]!;
    expect(JSON.parse(JSON.stringify(fx))).toEqual(fx);
    fx.rows.forEach((r, i) => {
      expect(r.seq).toBe(i + 1);
      expect(r.view).toBe('full');
      if (r.view !== 'full') return;
      expect(isKnownKind(r.event.kind), r.event.kind).toBe(true);
      if (r.event.session !== undefined) expect(r.event.session).toMatch(HSID_PATTERN);
    });
    for (const card of cardsOf(fx.rows)) expect(validateCardV1(card, { mode: 'strict' }), String(card.cardId)).toEqual([]);
  });
});

describe('#gui-preview fake kernel (the real client over it)', () => {
  it('desk: serverSig verifies, the backlog fills the store (5 active + 12 past sessions, 4 cards), every card action verifies', async () => {
    const { store, key } = await connected('desk');
    expect(store.sessions.size).toBe(17);
    expect(store.liveCount()).toBe(4); // billing, warpline, gnomon-web, atelier (ledgerette's session exited)
    expect(store.stack().map((c) => c.kind)).toEqual(['knot', 'incident', 'permission', 'gate-class']);
    for (const c of store.stack()) {
      const actions = c.card.actions as unknown[];
      expect(await verifiedDecisions(subtle, key.spki, key.keyId, { cardId: c.cardId, contentHash: String(c.card.contentHash), actions })).toHaveLength(actions.length);
    }
  });

  it('stack-heavy holds 12 cards; empty holds none', async () => {
    expect((await connected('stack-heavy')).store.cards.size).toBe(12);
    const e = await connected('empty');
    expect(e.store.cards.size).toBe(0);
    expect(e.store.sessions.size).toBe(0);
  });

  it('approve removes that card through an approval.decide row on the follow subscription', async () => {
    const { client, store } = await connected('desk');
    client.onNotification((m, p) => m === 'event' && store.apply([(p as { row: unknown }).row]));
    const id = store.stack()[2]!.cardId;
    await client.call('approve', { cardId: id, decision: 'allow' });
    await new Promise((r) => setTimeout(r, 5));
    expect(store.cards.has(id)).toBe(false);
    expect(store.cards.size).toBe(3);
  });

  it('answers every method app.ts calls (and refuses session.open in plain words)', async () => {
    const app = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
    const called = new Set([...app.matchAll(/\.call(?:<[^>]*>)?\('([a-z.]+)'/g)].map((m) => m[1]!));
    expect(called.size).toBeGreaterThan(4);
    for (const m of called) expect(PREVIEW_METHODS, m).toContain(m);
    const { client } = await connected('empty');
    await expect(client.call('session.open', { cwd: '/x', model: 'claude', attended: true })).rejects.toThrow(/no kernel/);
  });

  it('paradigm-context: status lists the sidebar view; mod.view joins {focus:{hsid}} to that session slice through the real mod model', async () => {
    const { client } = await connected('paradigm-context');
    const st = await client.call<{ mods: { views: unknown[] } }>('status', {});
    expect(st.mods.views).toEqual([{ name: 'paradigm-context', viewId: 'paradigm-context.sheet', slot: 'sidebar', placement: 'append', dev: false }]);
    const billing = FIXTURES['paradigm-context']!.focus!;
    const r = await client.call<{ label: string; block: unknown }>('mod.view', { name: 'paradigm-context', viewId: 'paradigm-context.sheet', input: { focus: { hsid: billing } } });
    expect(r.label).toBe('mod:paradigm-context');
    const s = JSON.stringify(r.block);
    expect(s).toContain('billing');
    expect(s).toContain('"text":"tasks","tone":"head"},{"type":"Text","text":"5 of 9 open · 2 high"');
    expect(s).not.toMatch(/Button/);
    // a forged repo never picks the slice; no focus ⇒ unfocused
    expect(JSON.stringify((await client.call<{ block: unknown }>('mod.view', { name: 'paradigm-context', viewId: 'paradigm-context.sheet', input: { repo: 'billing', path: '/Users/matt/code/billing' } })).block)).toContain('focus a live session');
    await expect(client.call('mod.view', { name: 'ledger', viewId: 'ledger.sheet', input: {} })).rejects.toThrow(/mod ledger is not running/);
  });

  it('the workshop strip comes from the real mod model over the feed projection', () => {
    const rows = FIXTURES.workshop!.rows;
    expect(rows.map(feedEventOf).filter(Boolean).length).toBeGreaterThan(10);
    const block = workshopBlock(rows, { motion: 'full', theme: 'day' });
    const titles = (block.children as Array<{ title: string }>).map((z) => z.title);
    expect(titles[0]).toMatch(/^needs you \d+$/);
    expect(titles[1]).toBe('working 1 of 4');
  });

  it('S5: mod.view answers the Workshop from the real model, every cap passing checkCap; absent when not running', async () => {
    const { client } = await connected('workshop');
    const r = await client.call<{ label: string; block: { children: Array<{ children: Array<{ cap?: unknown }> }> } }>('mod.view', { name: 'gnomon.workshop', viewId: 'workshop.strip', input: {} });
    expect(r.label).toBe('mod:workshop');
    const caps = r.block.children.flatMap((z) => z.children).map((c) => c.cap).filter(Boolean);
    expect(caps.length).toBeGreaterThan(4);
    for (const c of caps) expect(checkCap(c).ok).toBe(true);
    const { client: c2 } = await connected('workshop-absent');
    await expect(c2.call('mod.view', { name: 'gnomon.workshop', viewId: 'workshop.strip', input: {} })).rejects.toThrow(/not running/);
  });
});

describe('#gui-preview stays out of the kernel-served bundle', () => {
  it('the bundle entry (src/main.ts) pulls in no src/preview file, and no core/ui file imports one', async () => {
    const r = await build({ entryPoints: [path.join(ROOT, 'src', 'main.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, metafile: true, logLevel: 'silent' });
    const inputs = Object.keys(r.metafile!.inputs);
    expect(inputs.some((p) => p.includes('src/ui/app.ts'))).toBe(true);
    expect(inputs.filter((p) => p.includes('src/preview/'))).toEqual([]);
    for (const dir of ['core', 'ui', 'setup']) for (const f of readdirSync(path.join(ROOT, 'src', dir))) expect(readFileSync(path.join(ROOT, 'src', dir, f), 'utf8'), f).not.toMatch(/preview\//);
  });

  it('the embedded (pinned) bundle carries no preview code', async () => {
    const { GUI_BUNDLE_FILES_B64 } = await import('../../gnomon/src/kernel/web/gui-bundle.js');
    const app = Buffer.from(GUI_BUNDLE_FILES_B64['app.js']!, 'base64').toString('utf8');
    expect(app.length).toBeGreaterThan(1000);
    expect(app).not.toContain(PREVIEW_MARKER);
    expect(app).not.toContain('FakeKernel');
  });
});

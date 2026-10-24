/**
 * #mods-admin: the GUI Mods panel's kernel half. Each request does what its `gnomon mod` verb does (and signs
 * nothing); the card is raised by the kernel's own scans; status.mods.installed / available read from the grant
 * table and the shipped first-party catalog; the Desk counts are #desk-stats' fold of the same rows.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { effectiveInstall, readGrants, removeTree } from '../src/kernel/manifest/index.js';
import { isUserPaused, StagedCardPickup, uninstallRequested } from '../src/kernel/modhost/control.js';
import { findFirstPartyRoot, ModsAdmin, MOD_ADMIN_REQUESTS } from '../src/kernel/modhost/mods-admin.js';
import { DeskTally, foldDeskStats, type DeskRow } from '../src/kernel/desk/desk-stats.js';
import { foldDeskStats as cliFold } from '../src/cli/desk-cli.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const MODS = path.resolve(PKG_ROOT, '..', 'gnomon-mods');
const WORKSHOP = path.join(MODS, 'workshop');
const HUMAN = 'p:abcdefgh/matt';
const GUI = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', credential: 'gui' };
const KERNEL = 'p:abcdefgh/kernel';
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function rig() {
  const root = fs.mkdtempSync(path.join(privateTmpRoot(), 'gma-'));
  cleanups.push(() => removeTree(root));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const touching: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: KERNEL, log: async () => undefined, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence: touching, root: auth });
  const running = new Set<string>();
  const host = { running: () => [...running], start: async (n: string) => void running.add(n), stop: async (n: string) => void running.delete(n), status: () => ({ running: [...running].map((name) => ({ name })), paused: [] }) };
  const pickup = new StagedCardPickup({ home, broker, authority: auth, host });
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  let configScans = 0;
  const admin = new ModsAdmin({
    home,
    trust: auth,
    host,
    scan: () => pickup.scan(),
    scanConfig: async () => void configScans++,
    raised: () => pickup.raised(),
    logRequest: async (kind, payload) => void rows.push({ kind, payload }),
    firstPartyRoot: MODS,
    userHome: root,
  });
  const decide = async (cardId: string, decision: string) => {
    const card = broker.card(cardId)!;
    const sig = cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: card.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    return broker.approve({ ...GUI, surface: 'browser' }, { cardId, decision, decisionSig: sig });
  };
  return { root, home, auth, broker, admin, rows, running, decide, configScans: () => configScans };
}

describe('#mods-admin requests mirror `gnomon mod`', () => {
  it('Install from the first-party catalog raises the install card in the stack and writes request.mod.install (the Install Workshop regression)', async () => {
    const t = rig();
    const res = await t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: WORKSHOP });
    expect(res).toMatchObject({ state: 'staged', name: 'gnomon.workshop', raised: true });
    const card = t.broker.card(res.cardId as string)!;
    expect(card).toMatchObject({ kind: 'install', state: 'pending' });
    expect(t.rows).toEqual([{ kind: 'request.mod.install', payload: { source: 'folder', path: fs.realpathSync.native(WORKSHOP) } }]);
    // nothing is installed until the human decides the card (root key + presence)
    expect(effectiveInstall(readGrants(t.home, t.auth), 'gnomon.workshop')).toBeUndefined();
    await t.decide(res.cardId as string, 'install');
    expect(effectiveInstall(readGrants(t.home, t.auth), 'gnomon.workshop')).toMatchObject({ source: 'package' });
    // the same folder again is the pin already: nothing to approve
    await expect(t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: WORKSHOP })).resolves.toMatchObject({ state: 'unchanged' });
  });

  it('only the human on a gui / device connection; bad payloads are refused, never staged', async () => {
    const t = rig();
    await expect(t.admin.request({ ...GUI, principalClass: 'agent' }, 'request.mod.install', { source: 'folder', path: WORKSHOP })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.admin.request({ ...GUI, credential: 'read-token' }, 'request.mod.pause', { name: 'gnomon.workshop' })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN' } });
    await expect(t.admin.request(GUI, 'request.mod.install', { source: 'git', url: 'https://github.com/a/b' })).rejects.toMatchObject({ refusal: { code: 'UNSUPPORTED' } });
    await expect(t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: 'relative/dir' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    await expect(t.admin.request(GUI, 'request.mod.install', { x: 1 })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    await expect(t.admin.request(GUI, 'request.mod.link', { path: path.join(t.root, 'nope') })).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND', data: { reason: 'no-folder' } } });
    await expect(t.admin.request(GUI, 'request.mod.link', { path: t.root })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST', data: { reason: 'no-manifest' } } });
    await expect(t.admin.request(GUI, 'request.mod.link', { path: WORKSHOP, extra: 1 })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    await expect(t.admin.request(GUI, 'request.mod.pause', { name: 'gnomon.workshop' })).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND', data: { reason: 'not-installed' } } });
    await expect(t.admin.request(GUI, 'request.mod.config', { name: 'gnomon.workshop' })).rejects.toMatchObject({ refusal: { code: 'BAD_REQUEST' } });
    expect(t.rows).toEqual([]);
    expect(t.broker.cards()).toEqual([]);
  });

  it('Pause, Start and Uninstall write what the CLI writes; uninstall raises its root-class card', async () => {
    const t = rig();
    const res = await t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: WORKSHOP });
    await t.decide(res.cardId as string, 'install');
    await expect(t.admin.request(GUI, 'request.mod.pause', { name: 'gnomon.workshop' })).resolves.toMatchObject({ state: 'paused' });
    expect(isUserPaused(t.home, 'gnomon.workshop')).toBe(true);
    expect(t.admin.status().installed.find((m) => m.name === 'gnomon.workshop')).toMatchObject({ state: 'paused', pausedWhy: 'user' });
    await expect(t.admin.request(GUI, 'request.mod.start', { name: 'gnomon.workshop' })).resolves.toMatchObject({ state: 'start-requested' });
    expect(isUserPaused(t.home, 'gnomon.workshop')).toBe(false);
    expect(t.running.has('gnomon.workshop')).toBe(true); // the scan consumed the start request
    await expect(t.admin.request(GUI, 'request.mod.uninstall', { name: 'gnomon.workshop' })).resolves.toMatchObject({ state: 'uninstall-requested' });
    expect(uninstallRequested(t.home, 'gnomon.workshop')).toMatchObject({ attended: true });
    expect(t.admin.status().installed[0]).toMatchObject({ uninstallRequested: true });
  });

  it('Configure is refused for a mod that declares no mcp server (the workshop), and needs a field', async () => {
    const t = rig();
    const res = await t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: WORKSHOP });
    await t.decide(res.cardId as string, 'install');
    await expect(t.admin.request(GUI, 'request.mod.config', { name: 'gnomon.workshop', args: ['--x'] })).rejects.toMatchObject({ refusal: { code: 'NOT_FOUND', data: { reason: 'no-server' } } });
    expect(t.configScans()).toBe(0);
  });

  it('Add from folder (link) stages a linked install card', async () => {
    const t = rig();
    const dir = path.join(t.root, 'my-lens');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'gnomon-manifest.json'), JSON.stringify({ manifest: 2, publisher: 'acme', kind: 'mod', name: 'my-lens', version: '1.0.0', abi: 'mod-abi:v1', provides: { tools: [{ name: 'lens.diff', effects: ['read'] }] } }));
    const res = await t.admin.request(GUI, 'request.mod.link', { path: dir });
    expect(res).toMatchObject({ state: 'staged', raised: true });
    expect(t.broker.card(res.cardId as string)).toMatchObject({ kind: 'install', state: 'pending' });
    expect(t.rows).toEqual([]); // link is dispatcher-only: no request row
    // a first-party package cannot be linked (publisher gnomon is first-party only): the refusal says why
    await expect(t.admin.request(GUI, 'request.mod.link', { path: WORKSHOP })).rejects.toMatchObject({ refusal: { code: 'FORBIDDEN', data: { reason: 'manifest-publisher' } } });
  });

  it('the request kinds are the six verbs', () => {
    expect(MOD_ADMIN_REQUESTS).toEqual(['request.mod.install', 'request.mod.link', 'request.mod.pause', 'request.mod.start', 'request.mod.uninstall', 'request.mod.config']);
  });
});

describe('#mods-admin status', () => {
  it('available lists the shipped first-party mods not installed (tier by hash); installed carries pin, tier, state and desk', async () => {
    const t = rig();
    const before = t.admin.status();
    expect(before.installed).toEqual([]);
    expect(before.catalog.root).toBe(MODS);
    const names = before.available.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(['gnomon.workshop', 'gnomon.ledger', 'gnomon.neurons', 'gnomon.constellation', 'gnomon.paradigm-context']));
    for (const a of before.available) {
      expect(a.tier).toBe('first-party');
      expect(path.isAbsolute(a.path)).toBe(true);
      expect(a.packageHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    const res = await t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: WORKSHOP });
    await t.decide(res.cardId as string, 'install');
    const after = t.admin.status();
    expect(after.available.map((a) => a.name)).not.toContain('gnomon.workshop');
    expect(after.installed).toEqual([
      expect.objectContaining({ name: 'gnomon.workshop', publisher: 'gnomon', version: '1.1.0', tier: 'first-party', source: 'package', state: 'running', mcp: null, update: null, desk: { shown: 0, suppressed: 0, kept: 0, open: 0, notNow: 0, stopHere: 0 } }),
    ]);
    expect(after.installed[0]!.packageHash).toBe(before.available.find((a) => a.name === 'gnomon.workshop')!.packageHash);
  });

  it('no catalog folder ⇒ nothing available, said so (root null)', () => {
    const t = rig();
    const a = new ModsAdmin({ home: t.home, trust: t.auth, host: { status: () => ({}) }, scan: async () => undefined, scanConfig: async () => undefined, firstPartyRoot: null });
    expect(a.status()).toEqual({ installed: [], available: [], catalog: { root: null } });
  });

  it('findFirstPartyRoot finds packages/gnomon-mods from inside the kernel package', () => {
    expect(findFirstPartyRoot(path.join(PKG_ROOT, 'src', 'kernel', 'modhost'))).toBe(fs.realpathSync.native(MODS));
  });
});

describe('#desk-stats DeskTally', () => {
  it('folds the seeded and the live rows exactly as `gnomon desk stats`', () => {
    const seed: DeskRow[] = [
      { kind: 'offer.shown', principal: KERNEL, seq: 1, payload: { offerId: 'offer:a', mod: 'gnomon.neurons', hsid: 'h' } },
      { kind: 'offer.decided', principal: KERNEL, seq: 2, payload: { offerId: 'offer:a', decision: 'open' } },
      { kind: 'offer.suppressed', principal: KERNEL, seq: 3, payload: { hsid: 'h', turn: 't/1', why: 'pending-card', name: 'gnomon.neurons' } },
      { kind: 'offer.shown', principal: 'p:abcdefgh/forged', seq: 4, payload: { offerId: 'offer:b', mod: 'gnomon.neurons', hsid: 'h' } },
    ];
    let listener: ((e: { seq: number; kind: string; principal?: string; payload?: unknown }) => void) | null = null;
    const log = {
      read: () => seed.map((r) => ({ seq: r.seq!, view: 'full', event: { kind: r.kind, principal: r.principal, payload: r.payload } })),
      onCommit: (l: typeof listener) => ((listener = l), () => void (listener = null)),
    };
    const tally = new DeskTally({ log: log as never, kernelPrincipal: KERNEL });
    expect(tally.of('gnomon.neurons')).toEqual({ shown: 1, suppressed: 1, kept: 0, open: 1, notNow: 0, stopHere: 0 });
    const kept = { kind: 'offer.kept', principal: KERNEL, seq: 5, payload: { offerId: 'offer:a', mod: 'gnomon.neurons', tool: 'x' } };
    listener!(kept);
    listener!({ kind: 'turn.result', seq: 6, payload: {} });
    expect(tally.of('gnomon.neurons')).toMatchObject({ kept: 1 });
    expect(tally.stats()).toEqual(foldDeskStats([...seed, kept], { kernelPrincipal: KERNEL }));
    expect(cliFold).toBe(foldDeskStats); // the CLI prints this same fold
    expect(tally.of('gnomon.ledger')).toEqual({ shown: 0, suppressed: 0, kept: 0, open: 0, notNow: 0, stopHere: 0 });
    tally.close();
    expect(listener).toBeNull();
  });
});

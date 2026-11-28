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
import { readStaged, stageInstall } from '../src/kernel/manifest/install.js';
import { mintTestPresence, withPinTablesForTest } from '../src/kernel/testing.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { readDeskMods, readMcpConfigRequest, readMcpOverrides, writeMcpOverride } from '../src/kernel/desk/mcp-passthrough.js';
import { ModSetup } from '../src/kernel/desk/mcp-setup.js';
import { runModConfig } from '../src/cli/desk-cli.js';
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
  return { root, home, auth, broker, admin, rows, running, decide, scan: () => pickup.scan(), raised: () => pickup.raised(), configScans: () => configScans };
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

  it('the request kinds are the six verbs plus #mcp-setup', () => {
    expect(MOD_ADMIN_REQUESTS).toEqual(['request.mod.install', 'request.mod.link', 'request.mod.pause', 'request.mod.start', 'request.mod.uninstall', 'request.mod.config', 'request.mod.setup']);
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
      expect.objectContaining({ name: 'gnomon.workshop', publisher: 'gnomon', version: '1.1.1', tier: 'first-party', source: 'package', state: 'running', mcp: null, update: null, desk: { shown: 0, suppressed: 0, kept: 0, open: 0, notNow: 0, stopHere: 0 } }),
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

describe('the pickup and a retired first-party build (S1.4 P0 review, Aegis N-a)', () => {
  it('a card an earlier kernel staged for dimension 1.0.0 is not raised, is refused as retired (not INTEGRITY), and its staged record is expired', async () => {
    const OLD = 'sha256:7e79c8439b116dbbc1dd542dba84e848546247c820e59954ce20ee49b4ee34c9';
    const t = rig();
    const fx = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'first-party-retired', 'dimension-1.0.0.json'), 'utf8')) as { files: Record<string, string> };
    const src = path.join(t.root, 'old', 'dimension');
    fs.mkdirSync(src, { recursive: true });
    for (const [name, text] of Object.entries(fx.files)) fs.writeFileSync(path.join(src, name), text);
    // the earlier kernel (1.0.0 first-party, not retired) stages the card; nobody decides it before the upgrade
    const st = withPinTablesForTest(
      (tables) => {
        tables.firstParty.add(OLD);
        tables.retired.delete(OLD);
      },
      () => stageInstall({ home: t.home, source: src, via: 'package', requestedBy: HUMAN, trust: t.auth }),
    );
    if (st.state !== 'staged') throw new Error(`expected staged, got ${st.state}`);
    expect(readStaged(t.home, 'gnomon.dimension', st.cardId)!.card.state).toBe('pending');
    // this kernel's pickup
    await t.scan();
    expect(t.broker.card(st.cardId)).toBeUndefined();
    expect(t.raised()).not.toContain(st.cardId);
    const after = readStaged(t.home, 'gnomon.dimension', st.cardId)!;
    expect(after.card.state).toBe('expired');
    expect(after.decision).toBeUndefined();
    expect(effectiveInstall(readGrants(t.home, t.auth), 'gnomon.dimension')).toBeUndefined();
    // a second scan finds nothing pending and changes nothing
    await t.scan();
    expect(t.broker.card(st.cardId)).toBeUndefined();
    expect(readStaged(t.home, 'gnomon.dimension', st.cardId)!.card.state).toBe('expired');
    // a card for the shipped tree is still raised in the same home
    const ok = stageInstall({ home: t.home, source: path.join(MODS, 'dimension'), via: 'package', requestedBy: HUMAN, trust: t.auth });
    if (ok.state !== 'staged') throw new Error(`expected staged, got ${ok.state}`);
    await t.scan();
    expect(t.broker.card(ok.cardId)?.state).toBe('pending');
  });
});

describe('#mcp-setup through #mods-admin (8.2 fixes item 1)', () => {
  const CANARY = 'CANARY-vault-5e0b21aa';
  const EXE = process.platform === 'win32' ? '.exe' : '';
  async function setupRig() {
    const t = rig();
    const bin = path.join(t.root, 'bin');
    fs.mkdirSync(bin);
    const node = path.join(bin, `node${EXE}`);
    fs.writeFileSync(node, '', { mode: 0o755 });
    fs.writeFileSync(path.join(t.root, '.claude.json'), JSON.stringify({ mcpServers: { neurons: { command: node, args: ['/x/main.js', 'mcp'], env: { NEURONS_VAULT: CANARY } } } }));
    const res = await t.admin.request(GUI, 'request.mod.install', { source: 'folder', path: path.join(MODS, 'neurons') });
    await t.decide(res.cardId as string, 'install');
    const events: Array<Record<string, unknown>> = [];
    const setup = new ModSetup({ home: t.home, broker: t.broker, mods: () => readDeskMods(t.home, t.auth), userHome: t.root, pathDirs: () => [bin], launchKey: Buffer.alloc(32, 3), emit: (e) => events.push(e) });
    const admin = new ModsAdmin({ home: t.home, trust: t.auth, host: { status: () => ({ running: [], paused: [] }) }, scan: async () => undefined, scanConfig: async () => undefined, firstPartyRoot: MODS, userHome: t.root, setup });
    return { ...t, bin, node, admin2: admin, setup, events };
  }

  it('status shows needs-config with the Claude Code candidate, names only (the canary never appears)', async () => {
    const t = await setupRig();
    const m = t.admin2.status().installed.find((x) => x.name === 'gnomon.neurons')!;
    expect(m.mcp).toMatchObject({ launch: 'needs-config', command: 'neurons', args: ['mcp'], setupPending: null });
    expect(m.mcp!.setup).toEqual([expect.objectContaining({ declId: 'user::neurons', source: 'user', match: 'name', oneTap: true, preselected: true, envNames: ['NEURONS_VAULT'], problem: null })]);
    expect(JSON.stringify(t.admin2.status())).not.toContain(CANARY);
  });

  it('status shows the EFFECTIVE launch, args through shownArgs (Aegis condition 9)', async () => {
    const t = await setupRig();
    writeMcpOverride(t.home, 'gnomon.neurons', { command: t.node, args: ['/x/main.js', '--api-key', 'sk-live-0123456789abcdef'] });
    const m = t.admin2.status().installed.find((x) => x.name === 'gnomon.neurons')!;
    expect(m.mcp).toMatchObject({ launch: 'ok', command: t.node, setup: [] });
    expect(m.mcp!.args).toEqual(['/x/main.js', '--api-key', '(hidden: looks like a secret)']);
    expect(JSON.stringify(m)).not.toContain('sk-live-0123456789abcdef');
  });

  it('one press: request.mod.setup through the real broker raises the card; allow (root key + presence) writes the override', async () => {
    const t = await setupRig();
    const res = await t.admin2.request(GUI, 'request.mod.setup', { items: [{ name: 'gnomon.neurons', from: 'user::neurons' }] });
    expect(res).toMatchObject({ pending: true });
    const card = t.broker.card(res.cardId as string)!;
    expect(card).toMatchObject({ kind: 'grant', state: 'pending' });
    expect(t.admin2.status().installed.find((x) => x.name === 'gnomon.neurons')!.mcp!.setupPending).toBe(res.cardId);
    expect(JSON.stringify(card)).not.toContain(CANARY);
    await t.decide(res.cardId as string, 'allow');
    expect(readMcpOverrides(t.home)['gnomon.neurons']).toEqual({ command: t.node, args: ['/x/main.js', 'mcp'], env: { NEURONS_VAULT: CANARY } });
    expect(t.admin2.status().installed.find((x) => x.name === 'gnomon.neurons')!.mcp).toMatchObject({ launch: 'ok', setup: [] });
    expect(JSON.stringify(t.events)).not.toContain(CANARY);
  });

  it('gnomon mod config --from-claude writes the same copy through the request file', async () => {
    const t = await setupRig();
    const out: string[] = [];
    const err: string[] = [];
    const io = { stdout: { write: (s: string) => void out.push(s) }, stderr: { write: (s: string) => void err.push(s) } } as never;
    const code = runModConfig(['gnomon.neurons', '--from-claude'], io, { home: t.home, trust: t.auth, env: {}, userHome: t.root, pathDirs: [t.bin] });
    expect(err.join('')).toBe('');
    expect(code).toBe(0);
    expect(readMcpConfigRequest(t.home, 'gnomon.neurons')!.config).toEqual({ command: t.node, args: ['/x/main.js', 'mcp'], env: { NEURONS_VAULT: CANARY } });
    expect(out.join('')).toContain('FROM       your neurons server (user)');
    expect(out.join('')).not.toContain(CANARY);
    // the request-file card (unverified source) never claims the Claude Code config
    expect(out.join('')).not.toContain('from your Claude Code config');
    expect(runModConfig(['gnomon.neurons', '--from-claude', 'nope'], io, { home: t.home, trust: t.auth, env: {}, userHome: t.root, pathDirs: [t.bin] })).toBe(1);
  });
});

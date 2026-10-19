/**
 * #mod-cli (M1.11 slice 3; spec §12.4, §12.5, §3.1 I3): `gnomon mod
 * install|link|list|status|pause|start|uninstall` over #manifest-loader and
 * the on-disk control surface, and the kernel's StagedCardPickup that raises
 * what the CLI staged through the REAL #approval-broker (raiseInstallCard
 * re-derives the card from the pinned snapshot). Platform-independent: no
 * daemon, no keys/ dir; homes under privateTmpRoot.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { effectiveInstall, linkedFolders, readGrants, removeTree } from '../src/kernel/manifest/index.js';
import { isUserPaused, MAX_PICKUP_CARDS, pendingStaged, StagedCardPickup, uninstallRequested } from '../src/kernel/modhost/control.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { EXAMPLE_MOD } from './mod-helpers.js';

const HUMAN = 'p:abcdefgh/matt';
const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});

function setup() {
  const root = fs.mkdtempSync(path.join(privateTmpRoot(), 'gmc-'));
  tmps.push(root);
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const out: string[] = [];
  const err: string[] = [];
  const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) } };
  const run = (argv: string[], env: NodeJS.ProcessEnv = {}) => runModCommand([...argv, '--home', home], io, { trust: auth, env });
  const copy = (name = 'hello'): string => {
    const dst = path.join(root, `src-${name}-${tmps.length}-${Math.random().toString(36).slice(2, 8)}`);
    fs.cpSync(EXAMPLE_MOD, dst, { recursive: true });
    return dst;
  };
  return { root, home, auth, out, err, io, run, copy, text: () => out.join(''), errText: () => err.join('') };
}

function brokerRig(auth: DevTestRootAuthority) {
  const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const sig = (cardId: string, decision: string, contentHash: string) =>
    cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision, cardContentHash: contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  const touching: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({
    kernel: SoftwareEd25519Signer.generate('kernel'),
    kernelPrincipal: 'p:abcdefgh/kernel',
    log: async (kind, payload) => void rows.push({ kind, payload }),
    approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)),
    presence: touching,
    root: auth,
    guiSessions: () => 1,
  });
  return { broker, rows, sig };
}

const H = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };

function fakeHost() {
  const running = new Set<string>();
  const calls: string[] = [];
  return {
    running: () => [...running].sort(),
    start: async (n: string) => {
      calls.push(`start ${n}`);
      running.add(n);
    },
    stop: async (n: string, why = 'stopped') => {
      calls.push(`stop ${n} ${why}`);
      running.delete(n);
    },
    calls,
    set: running,
  };
}

describe('gnomon mod install / link (stage, never sign)', () => {
  it('install stages a pending card, prints the hardened install-card lines, and appends no grant row', async () => {
    const t = setup();
    expect(await t.run(['install', t.copy()])).toBe(0);
    const s = t.text();
    expect(s).toMatch(/^STAGED {2}card:[0-9A-Z]{26}\n/);
    expect(s).toContain('│ Install mod hello 1.0.0 (mod) from package, tier local');
    expect(s).toContain('│ runs commands: 0 mcp server(s), 0 hook(s)'); // the kernel-composed count line
    expect(s).toContain('│ hooks: none');
    expect(s).toContain('signed  nothing');
    expect(pendingStaged(t.home).map((p) => p.name)).toEqual(['hello']);
    expect(readGrants(t.home, t.auth).installs).toEqual([]);
    // the count line is the third card line (index 2), before any manifest-controlled line
    const lines = s.split('\n').filter((l) => l.startsWith('  │ '));
    expect(lines[2]).toBe('  │ runs commands: 0 mcp server(s), 0 hook(s)');
  });

  it('re-staging the same snapshot raises no second card', async () => {
    const t = setup();
    const src = t.copy();
    await t.run(['install', src]);
    await t.run(['install', src]);
    expect(pendingStaged(t.home)).toHaveLength(1);
  });

  it('link stages a linked-folder card (tier local, the source path on the header)', async () => {
    const t = setup();
    const src = t.copy();
    expect(await t.run(['link', src])).toBe(0);
    expect(t.text()).toContain('from linked:');
    const rec = pendingStaged(t.home)[0]!.record;
    expect(rec.detail.source).toBe(`linked:${fs.realpathSync.native(src)}`);
    expect(rec.detail.tier).toBe('local');
  });

  it('a url source is refused (Move 1 stages local paths only); a bad manifest is refused with its code', async () => {
    const t = setup();
    expect(await t.run(['install', 'https://example.com/mod.tgz'])).toBe(1);
    expect(t.errText()).toContain('url-source');
    const src = t.copy();
    fs.writeFileSync(path.join(src, 'gnomon-manifest.json'), '{"manifest":1,"kind":"mod","name":"hello","version":"x"}');
    expect(await t.run(['install', src])).toBe(1);
    expect(t.errText()).toContain('REFUSED  SCHEMA');
    expect(pendingStaged(t.home)).toEqual([]);
  });

  it('from a kernel-spawned shell install still stages (I3 staging exception) and the card names the session', async () => {
    const t = setup();
    const hsid = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
    expect(await t.run(['install', t.copy()], { GNOMON_HSID: hsid })).toBe(0);
    const rec = pendingStaged(t.home)[0]!.record;
    expect(rec.card.hsid).toBe(hsid);
    expect(rec.card.attended).toBe(false);
  });
});

describe('the pickup raises staged cards through the real broker', () => {
  it('a CLI-staged card reaches the broker; Touch ID + root key installs it; the mod is started', async () => {
    const t = setup();
    await t.run(['install', t.copy()]);
    const { cardId } = pendingStaged(t.home)[0]!;
    const b = brokerRig(t.auth);
    const host = fakeHost();
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const p = new StagedCardPickup({ home: t.home, broker: b.broker, authority: t.auth, host, emit: (kind, payload) => void rows.push({ kind, payload }) });
    await p.scan();
    const card = b.broker.card(cardId)!;
    expect(card.kind).toBe('install');
    expect(card.state).toBe('pending');
    expect(rows.find((r) => r.kind === 'manifest.staged')?.payload).toMatchObject({ name: 'hello', cardId, via: 'cli' });
    await p.scan(); // never raised twice
    expect(b.rows.filter((r) => r.kind === 'approval.request')).toHaveLength(1);
    await b.broker.approve(H, { cardId, decision: 'install', decisionSig: b.sig(cardId, 'install', card.contentHash) });
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')?.cardId).toBe(cardId);
    await new Promise((r) => setTimeout(r, 20));
    expect(host.calls).toContain('start hello');
    expect(pendingStaged(t.home)).toEqual([]); // decided
  });

  it('falsifier: a staged file tampered after the CLI ran is refused INTEGRITY, never raised, and not retried until it changes', async () => {
    const t = setup();
    await t.run(['install', t.copy()]);
    const { cardId } = pendingStaged(t.home)[0]!;
    const file = path.join(t.home, 'mods', 'hello', 'staged', `${cardId.replace(':', '-')}.json`);
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    rec.detail.effects = [];
    fs.writeFileSync(file, JSON.stringify(rec));
    const b = brokerRig(t.auth);
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const p = new StagedCardPickup({ home: t.home, broker: b.broker, authority: t.auth, host: fakeHost(), emit: (kind, payload) => void rows.push({ kind, payload }) });
    await p.scan();
    await p.scan();
    expect(b.broker.card(cardId)).toBeUndefined();
    expect(rows.filter((r) => r.kind === 'manifest.refuse')).toHaveLength(1);
  });

  it(`falsifier: at most ${MAX_PICKUP_CARDS} staged cards are raised at once (the staged dirs are attacker-growable)`, async () => {
    const t = setup();
    const b = brokerRig(t.auth);
    const p = new StagedCardPickup({ home: t.home, broker: b.broker, authority: t.auth, host: fakeHost() });
    for (let i = 0; i < MAX_PICKUP_CARDS + 3; i++) {
      const src = t.copy();
      const m = JSON.parse(fs.readFileSync(path.join(src, 'gnomon-manifest.json'), 'utf8'));
      m.name = `m${i}`;
      m.provides.events = [`modns.m${i}.greeted`];
      m.requires.capabilities = [`log.append:modns.m${i}.*`];
      fs.writeFileSync(path.join(src, 'gnomon-manifest.json'), JSON.stringify(m));
      expect(await t.run(['install', src])).toBe(0);
    }
    await p.scan();
    expect(p.raised()).toHaveLength(MAX_PICKUP_CARDS);
  });
});

describe('gnomon mod list / status / pause / start / uninstall', () => {
  async function installed(t: ReturnType<typeof setup>, via: 'install' | 'link' = 'install') {
    await t.run([via, t.copy()]);
    const { cardId } = pendingStaged(t.home)[0]!;
    const b = brokerRig(t.auth);
    const host = fakeHost();
    const p = new StagedCardPickup({ home: t.home, broker: b.broker, authority: t.auth, host });
    await p.scan();
    const c = b.broker.card(cardId)!;
    await b.broker.approve(H, { cardId, decision: 'install', decisionSig: b.sig(cardId, 'install', c.contentHash) });
    await new Promise((r) => setTimeout(r, 20));
    return { b, host, p, cardId };
  }

  it('list and status read the grant table, pending cards and markers', async () => {
    const t = setup();
    expect(await t.run(['list'])).toBe(0);
    expect(t.text()).toContain('no mods installed or staged');
    await installed(t);
    t.out.length = 0;
    await t.run(['list']);
    expect(t.text()).toMatch(/^hello\s+installed\s+sha256:/m);
    t.out.length = 0;
    expect(await t.run(['status', 'hello'])).toBe(0);
    expect(t.text()).toMatch(/tier +local/);
    expect(t.text()).toMatch(/source +package/);
    expect(await t.run(['status', 'nope'])).toBe(1);
  });

  it('pause stops the running mod and keeps it stopped; start clears it and asks for an operator start', async () => {
    const t = setup();
    const { host, p } = await installed(t);
    expect(host.running()).toEqual(['hello']);
    expect(await t.run(['pause', 'hello'])).toBe(0);
    expect(isUserPaused(t.home, 'hello')).toBe(true);
    await p.scan();
    expect(host.running()).toEqual([]);
    expect(host.calls).toContain('stop hello paused');
    expect(await t.run(['start', 'hello'])).toBe(0);
    expect(isUserPaused(t.home, 'hello')).toBe(false);
    await p.scan();
    expect(host.running()).toEqual(['hello']);
  });

  it('pause is allowed from a kernel-spawned shell (it narrows); start and uninstall are refused there (human-only)', async () => {
    const t = setup();
    await installed(t);
    const env = { GNOMON_HSID: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB' };
    expect(await t.run(['pause', 'hello'], env)).toBe(0);
    expect(await t.run(['start', 'hello'], env)).toBe(1);
    expect(await t.run(['uninstall', 'hello'], env)).toBe(1);
    expect(t.errText()).toContain('kernel-spawned-shell');
    expect(isUserPaused(t.home, 'hello')).toBe(true);
    expect(uninstallRequested(t.home, 'hello')).toBeNull();
  });

  it('uninstall raises a root-class card; allow appends a root-signed grant.uninstall and stops the mod', async () => {
    const t = setup();
    const { b, host, p } = await installed(t, 'link');
    expect(linkedFolders(t.home, t.auth)).toHaveLength(1);
    expect(await t.run(['uninstall', 'hello'])).toBe(0);
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeDefined(); // nothing removed yet
    await p.scan();
    const card = b.broker.cards().find((c) => c.kind === 'grant')!;
    expect(card.state).toBe('pending');
    expect(JSON.stringify(card.block)).toContain('Uninstall mod hello');
    await b.broker.approve(H, { cardId: card.cardId, decision: 'allow', decisionSig: b.sig(card.cardId, 'allow', card.contentHash) });
    expect(b.rows.find((r) => r.kind === 'approval.decide' && r.payload.cardId === card.cardId)?.payload.rootSig).toBeDefined();
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeUndefined();
    expect(linkedFolders(t.home, t.auth)).toEqual([]);
    expect(host.calls).toContain('stop hello uninstalled');
    expect(uninstallRequested(t.home, 'hello')).toBeNull();
  });

  it('falsifier: an uninstall card denied leaves the install; a stale request (the pin moved) is dropped without a card', async () => {
    const t = setup();
    const { b, p } = await installed(t);
    await t.run(['uninstall', 'hello']);
    await p.scan();
    const card = b.broker.cards().find((c) => c.kind === 'grant')!;
    await b.broker.approve(H, { cardId: card.cardId, decision: 'deny', decisionSig: b.sig(card.cardId, 'deny', card.contentHash) });
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeDefined();
    fs.writeFileSync(path.join(t.home, 'mods', 'hello', 'uninstall.request'), JSON.stringify({ packageHash: `sha256:${'0'.repeat(64)}` }));
    await p.scan();
    expect(b.broker.cards().filter((c) => c.kind === 'grant')).toHaveLength(1);
    expect(uninstallRequested(t.home, 'hello')).toBeNull();
  });

  it('usage: no verb, an unknown verb, a bad name, a relative --home', async () => {
    const t = setup();
    expect(await runModCommand([], t.io)).toBe(64);
    expect(await t.run(['frob'])).toBe(64);
    expect(await t.run(['pause', '../x'])).toBe(64);
    expect(await runModCommand(['list', '--home', 'rel'], t.io)).toBe(64);
  });
});

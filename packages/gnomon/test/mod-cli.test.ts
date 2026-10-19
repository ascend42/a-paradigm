/**
 * #mod-cli (M1.11 slice 3; spec §12.4, §12.5, §3.1 I3): `gnomon mod
 * install|link|list|status|pause|start|uninstall` over #manifest-loader and
 * the on-disk control surface, and the kernel's StagedCardPickup that raises
 * what the CLI staged through the REAL #approval-broker (raiseInstallCard
 * re-derives the card from the pinned snapshot). Platform-independent and
 * run on win32 too (no G-WIN-05 row needed): no daemon, no keys/ dir, no
 * POSIX mode asserted, no POSIX path fixture (paths are built with
 * path.join and compared as fields, never matched inside JSON text), no ':'
 * in any file name (staged files are card-<ULID>.json); homes under
 * privateTmpRoot.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { appendGrantRow, effectiveInstall, linkedFolders, readGrants, removeTree } from '../src/kernel/manifest/index.js';
import { isUserPaused, MAX_PICKUP_CARDS, MAX_PICKUP_READS, MAX_STAGED_BYTES, pendingStaged, StagedCardPickup, uninstallRequested } from '../src/kernel/modhost/control.js';
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
    // Aegis C4: the staged record's requestedBy / hsid / attended are printed as claims, never as facts
    expect(t.text()).toContain(`│ claimed by the staged record (unverified): requested by p:${t.auth.ns}/cli · session ${hsid} · attended no`);
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
    expect(rows.find((r) => r.kind === 'manifest.staged')?.payload).toMatchObject({ name: 'hello', cardId, via: 'cli', claimed: { by: `p:${t.auth.ns}/cli` } });
    expect(rows.find((r) => r.kind === 'manifest.staged')?.payload.by).toBeUndefined(); // never logged as a fact
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

  it('Aegis C5: a scan reads at most MAX_PICKUP_READS records, skips oversized and refused-unchanged ones on lstat, and folds manifest.refuse with the real code', async () => {
    const t = setup();
    await t.run(['install', t.copy()]);
    const good = pendingStaged(t.home)[0]!;
    const dir = path.dirname(good.file);
    const body = fs.readFileSync(good.file, 'utf8');
    // 3 mods x 30 forged records naming themselves: each fails re-derivation (no such snapshot / card)
    const ids: string[] = [];
    for (const m of ['aa', 'bb', 'cc']) {
      const d = path.join(t.home, 'mods', m, 'staged');
      fs.mkdirSync(d, { recursive: true });
      for (let i = 0; i < 30; i++) {
        const id = `card:01H${'Z'.repeat(19)}${m.toUpperCase()}${String(i).padStart(2, '0')}`;
        const rec = JSON.parse(body);
        rec.card.cardId = id;
        rec.detail.name = m;
        fs.writeFileSync(path.join(d, `${id.replace(':', '-')}.json`), JSON.stringify(rec));
        ids.push(id);
      }
    }
    fs.writeFileSync(path.join(dir, `card-01H${'Z'.repeat(23)}.json`), 'x'.repeat(MAX_STAGED_BYTES + 1)); // oversized: skipped on lstat
    const b = brokerRig(t.auth);
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const p = new StagedCardPickup({ home: t.home, broker: b.broker, authority: t.auth, host: fakeHost(), emit: (kind, payload) => void rows.push({ kind, payload }) });
    const total = () => rows.filter((r) => r.kind === 'manifest.refuse').reduce((n, r) => n + (r.payload.coalesced ? Number(r.payload.count) : 1), 0);
    await p.scan();
    p.stop(); // flushes the fold
    // one scan reads at most MAX_PICKUP_READS records (the good one + forged ones), so at most that many refusals
    expect(total()).toBeGreaterThan(0);
    expect(total()).toBeLessThanOrEqual(MAX_PICKUP_READS);
    await p.scan();
    await p.scan();
    await p.scan();
    p.stop();
    expect(total()).toBe(90); // every forged record refused exactly once (unchanged stamps are never re-read)
    const individual = rows.filter((r) => r.kind === 'manifest.refuse' && !r.payload.coalesced);
    expect(individual.length).toBeLessThanOrEqual(8);
    expect(individual.every((r) => r.payload.code !== 'INTEGRITY' || typeof r.payload.reason === 'string')).toBe(true);
    expect(new Set(individual.map((r) => r.payload.code)).has('REFUSED')).toBe(false); // ManifestRefusal codes, not a constant
    expect(b.broker.card(good.cardId)).toBeDefined(); // the real card is still raised
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
    expect(JSON.stringify(card.block)).toContain('claimed by the uninstall request (unverified)');
    expect(card.attended).toBe(true); // the CLI's claim, from the request file, not a kernel constant
    await b.broker.approve(H, { cardId: card.cardId, decision: 'allow', decisionSig: b.sig(card.cardId, 'allow', card.contentHash) });
    expect(b.rows.find((r) => r.kind === 'approval.decide' && r.payload.cardId === card.cardId)?.payload.rootSig).toBeDefined();
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeUndefined();
    expect(linkedFolders(t.home, t.auth)).toEqual([]);
    expect(host.calls).toContain('stop hello uninstalled');
    expect(uninstallRequested(t.home, 'hello')).toBeNull();
  });

  it('Aegis C1 falsifier: an old install row re-appended after an uninstall is rejected `replay` and does not revive the mod', async () => {
    const t = setup();
    const { b, p } = await installed(t);
    const file = path.join(t.home, 'grants.jsonl');
    const installLine = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.includes('"grant.install"'))!;
    await t.run(['uninstall', 'hello']);
    await p.scan();
    const card = b.broker.cards().find((c) => c.kind === 'grant')!;
    await b.broker.approve(H, { cardId: card.cardId, decision: 'allow', decisionSig: b.sig(card.cardId, 'allow', card.contentHash) });
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeUndefined();
    fs.appendFileSync(file, `${installLine}\n`);
    const g = readGrants(t.home, t.auth);
    expect(effectiveInstall(g, 'hello')).toBeUndefined();
    expect(g.rejected.map((r) => r.reason)).toContain('replay');
  });

  it('Aegis round 3: a backwards clock step between install and uninstall still applies the uninstall; two pins with the same now both apply', () => {
    const t = setup();
    const at = new Date(Date.UTC(2026, 9, 19, 12));
    const pin = (packageHash: string, now: Date, kind: 'grant.install' | 'grant.uninstall' = 'grant.install') =>
      kind === 'grant.install'
        ? appendGrantRow(t.home, t.auth, { kind, name: 'hello', manifestHash: `sha256:${'1'.repeat(64)}`, packageHash, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZA', source: 'package' }, now)
        : appendGrantRow(t.home, t.auth, { kind, name: 'hello', packageHash, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZB' }, now);
    const A = `sha256:${'a'.repeat(64)}`;
    const B = `sha256:${'b'.repeat(64)}`;
    pin(A, at);
    pin(B, at); // same millisecond
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')?.packageHash).toBe(B);
    pin(B, new Date(at.getTime() - 3_600_000), 'grant.uninstall'); // the clock stepped back an hour
    const g = readGrants(t.home, t.auth);
    expect(effectiveInstall(g, 'hello')).toBeUndefined();
    expect(g.rejected).toEqual([]);
  });

  it('Aegis round 3 falsifier: a pin row the reader would not resolve is refused after the write, so no caller reports it applied', () => {
    const t = setup();
    expect(() => appendGrantRow(t.home, t.auth, { kind: 'grant.install', name: 'hello', manifestHash: `sha256:${'1'.repeat(64)}`, packageHash: `sha256:${'a'.repeat(64)}`, cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZA', source: 'package', createdAt: 'not-a-date' })).toThrow(/did not take effect/);
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeUndefined();
  });

  it('Aegis round 3: junk staged files are remembered by stamp, so 64 of them cannot starve a real card', async () => {
    const t = setup();
    // MAX_PICKUP_READS junk files spread over mods listed before `hello` (at most MAX_PICKUP_CARDS listed per mod)
    for (let i = 0; i < MAX_PICKUP_READS; i++) {
      const d = path.join(t.home, 'mods', `aa${Math.floor(i / MAX_PICKUP_CARDS)}`, 'staged');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, `card-01H${'Z'.repeat(21)}${String(i).padStart(2, '0')}.json`), i % 2 ? 'not json' : '{"schemaVersion":"other"}');
    }
    await t.run(['install', t.copy()]);
    const real = pendingStaged(t.home).find((p) => p.name === 'hello')!;
    const b = brokerRig(t.auth);
    const p = new StagedCardPickup({ home: t.home, broker: b.broker, authority: t.auth, host: fakeHost() });
    await p.scan(); // the budget goes on the junk once
    expect(b.broker.card(real.cardId)).toBeUndefined(); // the falsifier has teeth: the first scan read only junk
    await p.scan(); // junk is skipped on its stamp; the real card is read and raised
    expect(b.broker.card(real.cardId)?.state).toBe('pending');
  });

  it('falsifier: an uninstall card denied leaves the install; a stale request (the pin moved) is dropped without a card', async () => {
    const t = setup();
    const { b, p } = await installed(t);
    await t.run(['uninstall', 'hello']);
    await p.scan();
    const card = b.broker.cards().find((c) => c.kind === 'grant')!;
    await b.broker.approve(H, { cardId: card.cardId, decision: 'deny', decisionSig: b.sig(card.cardId, 'deny', card.contentHash) });
    expect(effectiveInstall(readGrants(t.home, t.auth), 'hello')).toBeDefined();
    // a request written by any other process claims nothing: attended is false unless the file says so
    fs.writeFileSync(path.join(t.home, 'mods', 'hello', 'uninstall.request'), JSON.stringify({ packageHash: effectiveInstall(readGrants(t.home, t.auth), 'hello')!.packageHash }));
    await p.scan();
    const unattended = b.broker.cards().filter((c) => c.kind === 'grant' && c.state === 'pending');
    expect(unattended.map((c) => c.attended)).toEqual([false]);
    await b.broker.approve(H, { cardId: unattended[0]!.cardId, decision: 'deny', decisionSig: b.sig(unattended[0]!.cardId, 'deny', unattended[0]!.contentHash) });
    fs.writeFileSync(path.join(t.home, 'mods', 'hello', 'uninstall.request'), JSON.stringify({ packageHash: `sha256:${'0'.repeat(64)}` }));
    await p.scan();
    expect(b.broker.cards().filter((c) => c.kind === 'grant')).toHaveLength(2);
    expect(uninstallRequested(t.home, 'hello')).toBeNull();
  });

  it('status gives the same no-trust note as list; usage on error goes to stderr, asked-for help to stdout', async () => {
    const t = setup();
    const noTrust = { rootKeyId: null, ns: null, verifyRow: () => false };
    await runModCommand(['list', '--home', t.home], t.io, { trust: noTrust });
    await runModCommand(['status', 'hello', '--home', t.home], t.io, { trust: noTrust });
    expect(t.errText().match(/no provisioned root/g)).toHaveLength(2);
    t.out.length = 0;
    t.err.length = 0;
    expect(await runModCommand([], t.io)).toBe(64);
    expect(t.text()).toBe('');
    expect(t.errText()).toContain('usage: gnomon mod');
    t.err.length = 0;
    expect(await runModCommand(['--help'], t.io)).toBe(0);
    expect(t.text()).toContain('usage: gnomon mod');
    expect(t.errText()).toBe('');
  });

  it('usage: no verb, an unknown verb, a bad name, a relative --home', async () => {
    const t = setup();
    expect(await runModCommand([], t.io)).toBe(64);
    expect(await t.run(['frob'])).toBe(64);
    expect(await t.run(['pause', '../x'])).toBe(64);
    expect(await runModCommand(['list', '--home', 'rel'], t.io)).toBe(64);
  });
});

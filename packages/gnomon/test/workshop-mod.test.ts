/**
 * #workshop-mod (spec §11.6, G-WSP-01; M1.11 slice 3). The first first-party
 * mod (packages/gnomon-mods/workshop): installed through `gnomon mod install`
 * and the real broker card, tier first-party (its packageHash is pinned in
 * FIRST_PARTY_PACKAGE_HASHES), declared effects none beyond `read`, state ONLY
 * from the host's projected kernel-event feed (modhost/feed.ts). Fixtures
 * render to golden blocks on every OS through a real ModHost (unsandboxed
 * test launcher; the darwin `mod` profile path is test/mod-sandbox.test.ts).
 * Platform-independent and run on win32 too (no G-WIN-05 row needed): the
 * pinned packageHash covers posix paths + sha256 + size only and the tree is
 * LF-pinned (.gitattributes), children are plain node processes as in
 * test/mod-host.test.ts, and no POSIX mode or path fixture is asserted.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MOD_ABI_ID, checkCap } from '@a-company/gnomon-contracts';
import { ApprovalBroker, approvalsKeyFrom, type PresenceProvider } from '../src/kernel/broker/index.js';
import { DEV_TEST_ROOT_ACK, DevTestRootAuthority } from '../src/kernel/identity/root-authority.js';
import { DaemonChildren } from '../src/kernel/lifecycle/children.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';
import { approveMessage, KeyRing, signaturePreimage, SoftwareEd25519Signer } from '../src/kernel/log/signer.js';
import { effectiveInstall, readGrants, removeTree } from '../src/kernel/manifest/index.js';
import { FIRST_PARTY_PACKAGE_HASHES } from '../src/kernel/manifest/install.js';
import { hashSourceTree } from '../src/kernel/manifest/snapshot.js';
import { pendingStaged, StagedCardPickup } from '../src/kernel/modhost/control.js';
import { FEED_BACKLOG_KINDS, FEED_KINDS, FeedBacklog, feedBacklog, projectFeedEvent } from '../src/kernel/modhost/feed.js';
import type { ModHost, ModHostOptions } from '../src/kernel/modhost/host.js';
import { createModHostForTest, decideInstallCard, mintTestPresence, unsandboxedModLauncher } from '../src/kernel/testing.js';
import { installPresenceBinding, readStaged, stageInstall } from '../src/kernel/manifest/install.js';
import { EXAMPLE_MOD, writeModFolder } from './mod-helpers.js';
import { runModCommand } from '../src/cli/mod-cli.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const WORKSHOP = path.resolve(PKG_ROOT, '..', 'gnomon-mods', 'workshop');
const HUMAN = 'p:abcdefgh/matt';
const H = { connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZA', principal: HUMAN, principalClass: 'human', surface: 'browser', credential: 'gui' };
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function installedWorkshop(opts: { feedBacklog?: ModHostOptions['feedBacklog'] } = {}) {
  const root = fs.mkdtempSync(path.join(privateTmpRoot(), 'gws-'));
  cleanups.push(() => removeTree(root));
  const home = path.join(root, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const auth = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const out: string[] = [];
  const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => out.push(s) } };
  expect(await runModCommand(['install', WORKSHOP, '--home', home], io, { trust: auth })).toBe(0);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const touching: PresenceProvider = { prove: async (req) => mintTestPresence(req.purpose, { bind: req.binding }) };
  const broker = new ApprovalBroker({ kernel: SoftwareEd25519Signer.generate('kernel'), kernelPrincipal: 'p:abcdefgh/kernel', log: async () => undefined, approvals: approvalsKeyFrom(ring, (p) => (p === HUMAN ? keyId : undefined)), presence: touching, root: auth });
  const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
  const children = new DaemonChildren({ append: async (kind, payload) => void events.push({ kind, payload }), control: processControlFor(), boot: 'test', graceMs: 1_000 });
  const host: ModHost = createModHostForTest({ home, trust: auth, children, emit: (kind, payload) => void events.push({ kind, payload }), callTimeoutMs: 10_000, ...(opts.feedBacklog ? { feedBacklog: opts.feedBacklog } : {}) }, { launcher: unsandboxedModLauncher });
  cleanups.push(() => host.stopAll());
  const pickup = new StagedCardPickup({ home, broker, authority: auth, host });
  await pickup.scan();
  const { cardId } = { cardId: pickup.raised()[0]! };
  const card = broker.card(cardId)!;
  const sig = cryptoSign('sha256', signaturePreimage('approve', approveMessage({ cardId, decision: 'install', cardContentHash: card.contentHash, approverPrincipalId: HUMAN })), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  await broker.approve(H, { cardId, decision: 'install', decisionSig: sig });
  return { root, home, auth, host, broker, children, out: out.join(''), events };
}

/** The example mod, plus a command that reports how many `event` notifications it received. */
const HELLO_COUNTING = `
import { serveMod } from './gnomon-mod-sdk.mjs';
let events = 0;
serveMod({
  onEvent: () => { events++; },
  views: { 'hello.panel': async () => ({ schemaVersion: 'display-block:v1', type: 'Text', text: 'example.hello' }) },
  commands: { 'hello.bump': async () => ({ ok: true }), 'hello.events': async () => ({ events }), 'hello.deaf': async () => { setInterval(() => {}, 1000); setTimeout(() => process.stdin.pause(), 20); return { deaf: true }; } },
  tools: { 'hello.greet': async () => ({ greeting: 'example.hello' }), 'hello.count': async () => ({ count: 0 }) },
});
`;

async function installHello(w: { root: string; home: string; auth: DevTestRootAuthority }, opts: { feed?: boolean } = {}): Promise<void> {
  const m = JSON.parse(fs.readFileSync(path.join(EXAMPLE_MOD, 'gnomon-manifest.json'), 'utf8'));
  m.provides.commands.push({ id: 'hello.events', title: 'Events received' }, { id: 'hello.deaf', title: 'Stop reading stdin' });
  if (opts.feed) m.requires.capabilities.push('log.read');
  const src = writeModFolder(path.join(w.root, 'example.hello'), m, HELLO_COUNTING);
  const st = stageInstall({ home: w.home, source: src, via: 'package', requestedBy: 'p:abcdefgh/cli', trust: w.auth });
  if (st.state !== 'staged') throw new Error('expected staged');
  const bind = installPresenceBinding(st.cardId, readStaged(w.home, 'example.hello', st.cardId)!.card.contentHash, 'install');
  decideInstallCard(w.home, 'example.hello', st.cardId, 'install', { presenceToken: mintTestPresence('mod.install', { bind }), authority: w.auth });
}

const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(WORKSHOP, 'fixtures', f), 'utf8'));

describe('#workshop-mod', () => {
  it('its packageHash is the pinned first-party hash (an edit to the package is a new install card)', () => {
    const h = hashSourceTree(WORKSHOP, 'gnomon.workshop', () => undefined).packageHash;
    // an intended edit: `npm run repin:first-party` regenerates the goldens, then pin the hash printed here
    expect([...FIRST_PARTY_PACKAGE_HASHES], `the Workshop tree now hashes to ${h}: pin it in FIRST_PARTY_PACKAGE_HASHES (src/kernel/manifest/install.ts)`).toContain(h);
  });

  it('S5: every golden cap is the closed contracts shape (6 hues) and keeps its accessible text', () => {
    for (const f of ['strip', 'strip-reduced']) {
      const caps: Array<{ text: unknown; cap: unknown }> = [];
      const walk = (n: unknown): void => {
        if (!n || typeof n !== 'object') return;
        const o = n as Record<string, unknown>;
        if (o.type === 'Text' && o.cap !== undefined) caps.push({ text: o.text, cap: o.cap });
        if (Array.isArray(o.children)) o.children.forEach(walk);
      };
      walk(fixture(`${f}.golden.json`));
      expect(caps.length, f).toBeGreaterThanOrEqual(3);
      for (const c of caps) {
        expect(checkCap(c.cap), JSON.stringify(c.cap)).toMatchObject({ ok: true });
        expect(typeof c.text === 'string' && c.text.length > 0).toBe(true);
      }
      expect(caps.map((c) => (c.cap as { state: string }).state)).toContain('needs');
    }
    expect(fs.readFileSync(path.join(WORKSHOP, 'model.mjs'), 'utf8')).toMatch(/export const HUES = 6;/);
  });

  it('it echoes the current modAbiId (a mod-ABI move needs a new Workshop build)', () => {
    expect(fs.readFileSync(path.join(WORKSHOP, 'index.mjs'), 'utf8')).toContain(`const MOD_ABI_ID = '${MOD_ABI_ID}'`);
  });

  it('installs through gnomon mod install + the broker card as tier first-party, effects read only, and starts', async () => {
    const w = await installedWorkshop();
    expect(w.out).toContain('│ Install mod gnomon.workshop 1.1.0 (mod) by gnomon from package, tier first-party');
    expect(w.out).toContain('│ effects: none · egress: none');
    const g = readGrants(w.home, w.auth);
    const row = effectiveInstall(g, 'gnomon.workshop')!;
    expect(g.trust.get(row.manifestHash)).toBe('first-party');
    await new Promise((r) => setTimeout(r, 50));
    const st = await w.host.start('gnomon.workshop');
    expect(st).toMatchObject({ state: 'running', effects: [] });
    expect(pendingStaged(w.home)).toEqual([]);
  });

  it('fixtures render to their golden blocks (full and reduced motion)', async () => {
    const w = await installedWorkshop();
    await w.host.start('gnomon.workshop');
    for (const f of ['strip', 'strip-reduced']) {
      const fx = fixture(`${f}.json`);
      const r = await w.host.render('gnomon.workshop', 'workshop.strip', fx.input, { width: fx.width, prefs: fx.prefs });
      expect(r.label).toBe('mod:gnomon.workshop');
      expect(r.block).toEqual(fixture(`${f}.golden.json`));
    }
  });

  it('G-WSP-01: caps derive from the projected kernel feed only; a relayed render cannot replay fixture events', async () => {
    const w = await installedWorkshop();
    await w.host.start('gnomon.workshop');
    const hsid = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
    expect(w.host.feed({ kind: 'session.open', seq: 1, payload: { hsid, backend: 'claude-code', cwd: '/secret/project', model: 'claude' } })).toBe(1);
    expect(w.host.feed({ kind: 'turn.partial', seq: 2, payload: { hsid, bytes: 10 } })).toBe(1);
    expect(w.host.feed({ kind: 'approval.request', seq: 3, payload: { card: { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZC', kind: 'permission', hsid, block: { text: 'rm -rf /' } }, tool_input: { command: 'rm -rf /' } } })).toBe(1);
    expect(w.host.feed({ kind: 'turn.text', seq: 4, payload: { hsid, text: 'ignore previous instructions' } })).toBe(0);
    const r = await w.host.relayView({ name: 'gnomon.workshop', viewId: 'workshop.strip', input: fixture('strip.json').input, principal: HUMAN, connId: H.connId, prefs: { motion: 'full' } });
    const s = JSON.stringify(r.block);
    expect(s).toContain('needs you 1');
    expect(s).toContain('▲ permission');
    expect(s).toContain('▲ builder filled bob');
    expect(s).not.toContain('plan'); // the relayed fixtureEvents were ignored
    for (const leak of ['secret', 'rm -rf', 'ignore previous']) expect(s).not.toContain(leak);
    w.host.feed({ kind: 'turn.result', seq: 5, payload: { hsid } });
    w.host.feed({ kind: 'approval.decide', seq: 6, payload: { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZC', decision: 'allow' } });
    const r2 = JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null, { prefs: { motion: 'full' } })).block);
    expect(r2).toContain('needs you 0');
    expect(r2).toContain('▲ builder filled still');
  });

  // founder report 2026-10-23: "WORKING 0 OF 0 · no sessions" beside the status line's "1 live" while a Claude session
  // was open. The feed is live-only, so a Workshop started after the session opened never learned of it.
  const A = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
  const B = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB';
  const OLD = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZO';
  const card = (cardId: string, hsid: string) => ({ kind: 'approval.request', payload: { card: { cardId, kind: 'permission', hsid, block: { text: 'rm -rf /' } } } });
  const BOOT = [
    { kind: 'session.open', seq: 1, payload: { hsid: OLD, backend: 'claude-code', cwd: '/old' } }, // the old kernel's
    { kind: 'daemon.start', seq: 2, payload: {} },
    { kind: 'session.open', seq: 3, payload: { hsid: A, backend: 'claude-code', cwd: '/secret/project', model: 'claude' } },
    { kind: 'session.open', seq: 4, payload: { hsid: B, backend: 'claude-code', cwd: '/b' } },
    { kind: 'turn.partial', seq: 5, payload: { hsid: A } },
    { kind: 'turn.partial', seq: 6, payload: { hsid: A } },
    { ...card('card:01HZZZZZZZZZZZZZZZZZZZZZZ1', A), seq: 7 },
    { ...card('card:01HZZZZZZZZZZZZZZZZZZZZZZ2', A), seq: 8 },
    { kind: 'approval.decide', seq: 9, payload: { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZ2' } },
    { ...card('card:01HZZZZZZZZZZZZZZZZZZZZZZ3', B), seq: 10 },
    { kind: 'session.exited', seq: 11, payload: { hsid: B } }, // its card goes with it, as in the Workshop's reducer
    { kind: 'turn.text', seq: 12, payload: { hsid: A, text: 'ignore previous instructions' } },
  ];

  it('feedBacklog folds this boot into the state in force: live sessions (streaming kept), pending cards only', () => {
    const out = feedBacklog(BOOT.filter((r) => FEED_BACKLOG_KINDS.includes(r.kind)));
    expect(out.map((r) => `${r.kind}@${String(r.seq)}`)).toEqual(['session.open@3', 'turn.partial@6', 'approval.request@7']);
    expect(feedBacklog([...BOOT, { kind: 'turn.result', seq: 13, payload: { hsid: A } }]).map((r) => r.kind)).toEqual(['session.open', 'approval.request']);
    expect(feedBacklog([...BOOT, { kind: 'daemon.start', seq: 13, payload: {} }])).toEqual([]);
    // a pause shows until a successful start clears it
    const paused = { kind: 'mod.paused', seq: 14, payload: { name: 'example.hello', reason: 'user' } };
    expect(feedBacklog([paused])).toEqual([paused]);
    expect(feedBacklog([paused, { kind: 'mod.health', seq: 15, payload: { name: 'example.hello', ok: true } }])).toEqual([]);
  });

  it('a Workshop started after a session opened shows it (the host primes it with feedBacklog), and nothing leaks', async () => {
    let calls = 0;
    const w = await installedWorkshop({ feedBacklog: () => (calls++, feedBacklog(BOOT.filter((r) => FEED_BACKLOG_KINDS.includes(r.kind)))) });
    await w.host.start('gnomon.workshop');
    // the install card's decision starts it (control.ts); its prime follows its init
    for (let i = 0; i < 100 && calls === 0; i++) await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
    const s = JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null, { prefs: { motion: 'full' } })).block);
    expect(s).toContain('working 1 of 1');
    expect(s).toContain('▲ builder filled bob');
    expect(s).toContain('needs you 1');
    for (const leak of ['secret', 'rm -rf', 'ignore previous', 'no sessions']) expect(s).not.toContain(leak);
    // the live feed carries on from there (a replayed row is idempotent)
    w.host.feed({ kind: 'session.exited', seq: 13, payload: { hsid: A } });
    await new Promise((r) => setTimeout(r, 50));
    const s2 = JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null)).block);
    expect(s2).toContain('working 0 of 0');
    expect(s2).toContain('needs you 0');
  });

  it('Aegis L: FeedBacklog(requireBoot) folds nothing before THIS boot\'s daemon.start is released; then only this boot', () => {
    const fold = new FeedBacklog({ requireBoot: true });
    for (const r of BOOT.slice(0, 1)) fold.observe(r); // the previous boot's session, its daemon.start not released yet
    expect(fold.snapshot()).toEqual([]);
    expect(fold.bootSeq).toBeNull();
    for (const r of BOOT.slice(1)) fold.observe(r);
    expect(fold.bootSeq).toBe(2);
    expect(fold.snapshot().map((r) => `${r.kind}@${String(r.seq)}`)).toEqual(['session.open@3', 'turn.partial@6', 'approval.request@7']);
    // a row at or below the fold's head is not folded twice (a re-delivered session.open keeps the streaming edge)
    fold.observe({ kind: 'session.open', seq: 3, payload: { hsid: A, cwd: '/secret/project' } });
    expect(fold.snapshot().map((r) => r.kind)).toEqual(['session.open', 'turn.partial', 'approval.request']);
  });

  it('Aegis M: the fold is incremental (O(state) snapshot); a stale fold resyncs from this boot only, bounded by the head', () => {
    const fold = new FeedBacklog({ requireBoot: true });
    for (const r of BOOT) fold.observe(r);
    const before = fold.snapshot();
    expect(fold.snapshot()).toEqual(before); // a snapshot reads nothing and changes nothing
    fold.markStale();
    expect(fold.stale).toBe(true);
    const later = { kind: 'session.open', seq: 20, payload: { hsid: B, cwd: '/b' } };
    // the resync rows come from fromSeq = bootSeq (2); a row past the head is not folded by the resync
    fold.resync([...BOOT.slice(1), later], 12);
    expect(fold.stale).toBe(false);
    expect(fold.snapshot()).toEqual(before);
    fold.observe(BOOT[2]!); // a queued row at or below the resync head is skipped
    expect(fold.snapshot()).toEqual(before);
    fold.observe(later); // the live rows carry on past the head
    expect(fold.snapshot().map((r) => r.seq)).toEqual([3, 6, 20, 7]);
    // the daemon wires it so: observe in flushFeed BEFORE mods.feed, and a log.read only on the stale path, from bootSeq
    const daemon = fs.readFileSync(path.resolve(PKG_ROOT, 'src', 'kernel', 'lifecycle', 'daemon.ts'), 'utf8');
    expect(daemon).toMatch(/feedFold\.observe\(e\);[^]*?mods\.feed\(e\);/);
    const wiring = daemon.slice(daemon.indexOf('feedBacklog: () => {'), daemon.indexOf('return feedFold.snapshot();'));
    expect(wiring).toMatch(/if \(feedFold\.stale\) \{/);
    expect(wiring).toMatch(/log\.read\(\{ reader: \{ class: 'human' \}, fromSeq: from, toSeq: head, kinds: FEED_BACKLOG_KINDS \}\)/);
    expect(wiring.match(/log\.read\(/g)).toHaveLength(1);
  });

  it('Aegis L: rows released during init reach the mod once, inside its backlog and in order (knot and streaming kept)', async () => {
    const fold = new FeedBacklog({ requireBoot: true });
    let calls = 0;
    const w = await installedWorkshop({ feedBacklog: () => (calls++, fold.snapshot()) });
    for (let i = 0; i < 100 && calls === 0; i++) await new Promise((r) => setTimeout(r, 20)); // the install's own start
    await w.host.stop('gnomon.workshop');
    const daemonFlush = (r: (typeof BOOT)[number]): number => (fold.observe(r), w.host.feed(r)); // as daemon.ts flushFeed does
    daemonFlush({ kind: 'daemon.start', seq: 2, payload: {} });
    const starting = w.host.start('gnomon.workshop');
    for (let i = 0; i < 500 && !w.host.running().includes('gnomon.workshop'); i++) await new Promise((r) => setImmediate(r));
    expect(calls).toBe(1); // still initialising: not primed yet
    // committed and released while the mod initialises: the feed skips it, the fold keeps it
    expect(daemonFlush({ kind: 'session.open', seq: 3, payload: { hsid: A, backend: 'claude-code', cwd: '/secret/project' } })).toBe(0);
    expect(daemonFlush({ kind: 'warpline.knot', seq: 4, payload: { hsid: A } })).toBe(0);
    expect(daemonFlush({ kind: 'turn.partial', seq: 5, payload: { hsid: A } })).toBe(0);
    expect(await starting).toMatchObject({ state: 'running' });
    expect(calls).toBe(2);
    const s = JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null, { prefs: { motion: 'full' } })).block);
    expect(s).toContain('working 1 of 1');
    expect(s).toContain('"state":"knot"'); // the duplicate-free order: session.open, then its knot, then its partial
    expect(s).toContain('bob');
    // after the prime the live feed reaches it again
    expect(daemonFlush({ kind: 'session.exited', seq: 6, payload: { hsid: A } })).toBe(1);
    await new Promise((r) => setTimeout(r, 50));
    expect(JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null)).block)).toContain('working 0 of 0');
  });

  it('Aegis L: a runner stopped while it initialises is never primed', async () => {
    let calls = 0;
    const w = await installedWorkshop({ feedBacklog: () => (calls++, []) });
    for (let i = 0; i < 100 && calls === 0; i++) await new Promise((r) => setTimeout(r, 20));
    await w.host.stop('gnomon.workshop');
    const starting = w.host.start('gnomon.workshop').catch((e: unknown) => e);
    for (let i = 0; i < 500 && !w.host.running().includes('gnomon.workshop'); i++) await new Promise((r) => setImmediate(r));
    await w.host.stop('gnomon.workshop');
    await starting;
    expect(calls).toBe(1); // only the install's start was primed
    expect(w.host.feed({ kind: 'session.open', payload: { hsid: A, cwd: '/p' } })).toBe(0);
  });

  it('without a backlog (the old behaviour) the same start shows no sessions: the falsifier for the priming', async () => {
    const w = await installedWorkshop();
    await w.host.start('gnomon.workshop');
    expect(JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null)).block)).toContain('no sessions');
  });

  it('the feed projection carries only the listed kernel fields', () => {
    expect(FEED_KINDS).not.toContain('turn.text');
    expect(projectFeedEvent({ kind: 'session.open', payload: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA', cwd: '/x/y', backend: 'local', systemPrompt: 'p' } })!.payload).toEqual({ hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA', backend: 'local', project: expect.any(Number) });
    expect(projectFeedEvent({ kind: 'approval.request', payload: { card: { cardId: 'bad id with spaces', kind: 'permission' } } })).toBeNull();
    expect(projectFeedEvent({ kind: 'approval.request', payload: { card: { cardId: 'card:01HZZZZZZZZZZZZZZZZZZZZZZC', kind: 'Not A Kind!' } } })!.payload.kind).toBe('card');
  });

  it('falsifier: a running mod without the log.read capability receives no event notification at all', async () => {
    const w = await installedWorkshop();
    await w.host.start('gnomon.workshop');
    await installHello(w);
    expect(await w.host.start('example.hello')).toMatchObject({ state: 'running' });
    expect(w.host.running()).toEqual(['example.hello', 'gnomon.workshop']);
    expect(w.host.feed({ kind: 'turn.partial', payload: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA' } })).toBe(1);
    expect(w.host.feed({ kind: 'session.open', payload: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA', cwd: '/p' } })).toBe(1);
    expect(await w.host.runCommand('example.hello', 'hello.events', null)).toEqual({ events: 0 });
    // positive control: the counter has teeth (its own modns kind does reach it)
    expect(w.host.sendEvent('example.hello', { kind: 'modns.example.hello.greeted' })).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(await w.host.runCommand('example.hello', 'hello.events', null)).toEqual({ events: 1 });
  });

  it('Aegis C2: a paused mod is visible (status, Workshop) and every path that relies on it fails closed', async () => {
    const w = await installedWorkshop();
    await w.host.start('gnomon.workshop');
    await installHello(w);
    await w.host.start('example.hello');
    const rows: Array<{ kind: string; payload: Record<string, unknown> }> = [];
    const pickup = new StagedCardPickup({ home: w.home, broker: w.broker, authority: w.auth, host: w.host, emit: (kind, payload) => void rows.push({ kind, payload }) });
    const out: string[] = [];
    const io = { stdout: { write: (x: string) => out.push(x) }, stderr: { write: (x: string) => out.push(x) } };
    expect(await runModCommand(['pause', 'example.hello', '--home', w.home], io, { trust: w.auth })).toBe(0);
    // visible before the kernel even acts on it (the marker is read by status)
    expect((w.host.status().paused as Array<{ name: string; why: string }>).map((p) => `${p.name}:${p.why}`)).toEqual(['example.hello:user']);
    // fail closed at once, before the pickup reaps the child: the first call is refused and stops it
    await expect(w.host.runCommand('example.hello', 'hello.bump', null)).rejects.toMatchObject({ modCode: 'PAUSED' });
    await pickup.scan();
    expect(w.host.running()).toEqual(['gnomon.workshop']);
    const paused = [...rows, ...w.events].find((r) => r.kind === 'mod.paused')!;
    expect(paused.payload).toMatchObject({ name: 'example.hello', reason: 'user' });
    // the Workshop shows it (the row reaches it through the feed)
    expect(w.host.feed({ kind: 'mod.paused', payload: paused.payload })).toBe(1);
    expect(JSON.stringify((await w.host.render('gnomon.workshop', 'workshop.strip', null)).block)).toContain('⏸ mod example.hello paused (user)');
    // fail closed: relays, commands, tools, admission and a plain start all refuse or stay paused
    const H2 = { principal: HUMAN, connId: H.connId };
    await expect(w.host.relayView({ name: 'example.hello', viewId: 'hello.panel', ...H2 })).rejects.toMatchObject({ modCode: 'PAUSED' });
    await expect(w.host.relayCommand({ name: 'example.hello', commandId: 'hello.bump', ...H2 })).rejects.toMatchObject({ modCode: 'PAUSED' });
    await expect(w.host.callTool('example.hello', 'hello.greet', {}, { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA' })).rejects.toMatchObject({ modCode: 'PAUSED' });
    await expect(w.host.admit('example.hello')).rejects.toMatchObject({ modCode: 'PAUSED' });
    expect(await w.host.start('example.hello')).toMatchObject({ state: 'paused', why: 'user' });
    expect(w.host.feed({ kind: 'turn.partial', payload: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA' } })).toBe(1); // only the workshop
    // the pause survives a kernel restart: a fresh host shows it from the marker
    const fresh = createModHostForTest({ home: w.home, trust: w.auth, children: w.children }, { launcher: unsandboxedModLauncher });
    expect((fresh.status().paused as Array<{ name: string }>).map((p) => p.name)).toEqual(['example.hello']);
    await expect(fresh.admit('example.hello')).rejects.toMatchObject({ modCode: 'PAUSED' });
    // start clears it
    expect(await runModCommand(['start', 'example.hello', '--home', w.home], io, { trust: w.auth })).toBe(0);
    await pickup.scan();
    expect(w.host.running()).toEqual(['example.hello', 'gnomon.workshop']);
    expect(w.host.status().paused).toEqual([]);
  });
  it('turn.partial is coalesced to one edge per session; turn.result re-arms it', async () => {
    const w = await installedWorkshop();
    await w.host.start('gnomon.workshop');
    const hsid = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
    expect(w.host.feed({ kind: 'turn.partial', payload: { hsid } })).toBe(1);
    expect(w.host.feed({ kind: 'turn.partial', payload: { hsid } })).toBe(0);
    expect(w.host.feed({ kind: 'turn.partial', payload: { hsid } })).toBe(0);
    expect(w.host.feed({ kind: 'turn.result', payload: { hsid } })).toBe(1);
    expect(w.host.feed({ kind: 'turn.partial', payload: { hsid } })).toBe(1);
  });

  it('falsifier: a mod that stops reading its stdin gets notifications DROPPED past the high-water mark (the kernel never buffers without bound)', async () => {
    const w = await installedWorkshop();
    await installHello(w, { feed: true });
    await new Promise((r) => setTimeout(r, 50));
    await w.host.stop('gnomon.workshop'); // only hello is fed
    await w.host.start('example.hello');
    await w.host.runCommand('example.hello', 'hello.deaf', null);
    await new Promise((r) => setTimeout(r, 100));
    expect(w.host.restarts('example.hello')).toBe(0); // still the same (deaf) child
    let reached = 0;
    for (let i = 0; i < 20_000; i++) reached += w.host.feed({ kind: 'session.open', payload: { hsid: `hsid:v1:01HZZZZZZZZZZZZZZZZZZ${String(i).padStart(4, '0')}`, cwd: `/p/${i}` } });
    const insp = w.host.inspect('example.hello') as { droppedNotifications: number };
    expect(insp.droppedNotifications).toBeGreaterThan(0);
    expect(reached + insp.droppedNotifications).toBe(20_000); // only hello is running and fed: each event reached it or was dropped
  });
});

// @gnomon-platform: darwin, linux
/**
 * #setup-endpoint end to end over the real `gnomon-web` child (unsandboxed
 * test seam), the #provisioner and the fake helper (spec §11.2 rule 11;
 * G-SET-08..14). Falsifiers:
 *   G-SET-08 a WS upgrade with the right Origin but no / a bad token: 0 dispatches, key.list never called
 *   G-SET-09 the token is on no child argv / env (extends G-WEB-05)
 *   G-SET-10 no gnomon-rpc verb is reachable
 *   G-SET-11 only `name` carries content: a page-supplied row / digest is refused
 *   G-SET-12 a second setup connection is refused; a token reuse inside the TTL aborts + journals
 *   G-SET-13 a closed socket aborts with cleanup
 *   G-SET-14 the full flow commits the same artifacts the CLI path does (G-SET-06)
 */
import { createPublicKey, verify } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authServerPreimage, SETUP_API, SETUP_API_ID } from '@a-company/gnomon-contracts';
import { acceptUnsignedHelperForTests, DEV_TEST_HELPER_ACK, identityJournalPath, identityPath, readIdentity, type HelperTransport } from '../src/kernel/identity/index.js';
import { Provisioner } from '../src/kernel/identity/index.js';
import { SETUP_SCRATCH_MAX_AGE_MS, SetupEndpoint, sweepSetupScratch, type SetupGrant } from '../src/kernel/setup/setup-endpoint.js';
import { createWebEndpointForTest } from '../src/kernel/testing.js';
import { privateTmpRoot, TEST_CLIENT_NONCE } from './daemon-helpers.js';
import { FakeHelper } from './helper-fake.js';
import { PKG_ROOT } from './helpers.js';
import { rpc, wsConnect, type RawWs } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const DEV = acceptUnsignedHelperForTests(DEV_TEST_HELPER_ACK);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tmp(): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(privateTmpRoot(), 'gnomon-sep-')));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function rig(o: { fake?: FakeHelper; gate?: (r: Record<string, unknown>) => Promise<void> | void; userHome?: string; alsoCheckHomes?: string[]; ttlMs?: number; idleMs?: number } = {}) {
  const u = o.userHome ?? tmp();
  const helperDir = tmp();
  const exe = path.join(helperDir, 'gnomon-helper');
  fs.writeFileSync(exe, `#!${process.execPath}\n`);
  fs.chmodSync(exe, 0o755);
  const fake = o.fake ?? new FakeHelper(null);
  const ops: string[] = [];
  const dispatched: string[] = [];
  const presence: Array<Record<string, unknown>> = [];
  const start = (): HelperTransport => {
    fake.revive();
    return {
      request: async (r) => {
        ops.push(String(r.op));
        await o.gate?.(r);
        return fake.request(r);
      },
      get alive() {
        return fake.alive;
      },
      close: async () => undefined,
      onExit: (cb: () => void) => fake.onExit(cb),
    } as unknown as HelperTransport;
  };
  const home = path.join(u, '.gnomon');
  const ep = new SetupEndpoint({
    home,
    userHome: u,
    helperPath: exe,
    host: 'mac-1',
    defaultName: 'founder',
    env: {},
    unsafe: null,
    verifier: DEV,
    start,
    once: () => (req) => fake.handle(req),
    exec: (f) => (f.endsWith('sw_vers') ? '15.1\n' : 'System Integrity Protection status: enabled.\n'),
    scriptPath: CHILD,
    createWeb: (w) => createWebEndpointForTest(w),
    onDispatch: (m) => dispatched.push(m),
    onEvent: (e) => e.type === 'presence' && presence.push(e as unknown as Record<string, unknown>),
    ...(o.alsoCheckHomes ? { alsoCheckHomes: o.alsoCheckHomes } : {}),
    ...(o.ttlMs !== undefined ? { ttlMs: o.ttlMs } : {}),
    ...(o.idleMs !== undefined ? { idleMs: o.idleMs } : {}),
  });
  cleanups.push(() => ep.stop());
  return { ep, home, ops, dispatched, presence, fake, start, exe };
}

const HELLO = { clientApis: [SETUP_API], features: [], clientNonce: TEST_CLIENT_NONCE, client: { name: 'gnomon-gui', version: '0', surface: 'browser' } };
const reason = (f: Record<string, unknown>) => (f.error as { data?: { data?: { reason?: string } } } | undefined)?.data?.data?.reason;

async function attach(g: SetupGrant, token: string = g.setupToken): Promise<{ ws: RawWs; hello: Record<string, unknown>; auth: Record<string, unknown> }> {
  const ws = await wsConnect(g.port);
  cleanups.push(() => ws.end());
  ws.sendJson(rpc(1, 'hello', HELLO));
  const hello = await ws.nextJson();
  ws.sendJson(rpc(2, 'auth', { setupToken: token }));
  const auth = await ws.nextJson();
  return { ws, hello, auth };
}

/** Next response with this id, collecting notifications on the way. */
async function call(ws: RawWs, id: number, method: string, params: Record<string, unknown> = {}, notes: Array<Record<string, unknown>> = []): Promise<Record<string, unknown>> {
  ws.sendJson(rpc(id, method, params));
  for (;;) {
    const f = await ws.nextJson(15_000);
    if (f.id === id) return f;
    notes.push(f);
  }
}

describe('#setup-endpoint', () => {
  it('G-SET-08: the right Origin with no / a bad token gets 0 dispatches and key.list is never called', async () => {
    const { ep, ops, dispatched } = rig();
    const g = await ep.start();
    const bad = await attach(g, 'A'.repeat(43));
    expect(reason(bad.auth)).toBe('unknown-token');
    expect(await bad.ws.closed()).toBe(1008);
    const none = await wsConnect(g.port);
    cleanups.push(() => none.end());
    none.sendJson(rpc(1, 'hello', HELLO));
    await none.nextJson();
    none.sendJson(rpc(2, 'setup.preflight', {}));
    expect(await none.closed()).toBe(1008);
    expect(dispatched).toEqual([]);
    expect(ops).not.toContain('key.list');
  });

  it('G-SET-09: the token is on no transport child argv or env, and the URL carries it only in the fragment', async () => {
    const { ep } = rig();
    const g = await ep.start();
    expect(JSON.stringify(ep.childArgv())).not.toContain(g.setupToken);
    expect(JSON.stringify(ep.childEnv())).not.toContain(g.setupToken);
    expect(ep.listenAddress()?.address).toBe('127.0.0.1');
    expect(g.url).toBe(`http://127.0.0.1:${g.port}/#setup=${g.setupToken}&k=${g.setupPublicKey}`);
  });

  it('serverSig is the ephemeral setup key over the setup preimage (clientApi gnomon-setup:v1)', async () => {
    const { ep } = rig();
    const g = await ep.start();
    const { hello, auth } = await attach(g);
    const h = hello.result as Record<string, string>;
    expect(h.setupApiId).toBe(SETUP_API_ID);
    const key = createPublicKey({ key: Buffer.from(g.setupPublicKey, 'base64url'), format: 'der', type: 'spki' });
    const pre = authServerPreimage(h.nonce!, TEST_CLIENT_NONCE, `ws://127.0.0.1:${g.port}/rpc`, { clientApi: SETUP_API, features: [] });
    expect(verify(null, Buffer.from(pre), key, Buffer.from(h.serverSig!, 'base64'))).toBe(true);
    expect(auth.result).toMatchObject({ authenticated: true });
  });

  it('G-SET-10 + G-SET-11: no gnomon-rpc verb is reachable; a page-supplied row or digest is refused', async () => {
    const { ep, dispatched, ops } = rig();
    const g = await ep.start();
    const { ws } = await attach(g);
    for (const [i, m, p] of [
      [3, 'setup.begin', { digest12: '000000000000' }],
      [4, 'setup.name', { name: 'x', row: { principalId: 'p:evil/x' } }],
      [5, 'setup.purge', { gen: 'not a gen' }],
    ] as const) {
      expect(reason(await call(ws, i, m, p as Record<string, unknown>))).toBe('setup-params');
    }
    expect(dispatched).toEqual([]);
    expect(ops).toEqual([]);
    for (const verb of ['session.list', 'approve', 'status']) {
      const f = await call(ws, 9, verb, {});
      expect(reason(f)).toBe('setup-params');
    }
    expect(dispatched).toEqual([]);
  });

  it('G-SET-14 (G-SET-06): the full flow commits the identity; presence 1 of 2 and 2 of 2 carry server digests', async () => {
    const { ep, home, presence } = rig();
    const g = await ep.start();
    const { ws } = await attach(g);
    const pff = await call(ws, 3, 'setup.preflight');
    const pf = pff.result as Record<string, unknown>;
    if (!pf) throw new Error(JSON.stringify(pff));
    expect(pf).toMatchObject({ ok: true, leftover: [], existing: null, defaultName: 'founder' });
    expect(reason(await call(ws, 4, 'setup.name', { name: 'Bad Name' }))).toBe('setup-params');
    expect((await call(ws, 5, 'setup.name', { name: 'founder' })).result).toEqual({ name: 'founder' });
    const notes: Array<Record<string, unknown>> = [];
    const bf = await call(ws, 6, 'setup.begin', {}, notes);
    const begun = bf.result as Record<string, unknown>;
    if (!begun) throw new Error(JSON.stringify(bf));
    const rec = readIdentity(home)!;
    expect(begun).toMatchObject({ rootKeyId: rec.rootKeyId, principalId: `p:${rec.ns}/founder`, deviceId: `dev:${rec.ns}/mac-1` });
    const pres = notes.filter((n) => n.method === 'setup.presence').map((n) => n.params as Record<string, unknown>);
    expect(pres.map((p) => [p.n, p.of, p.purpose])).toEqual([
      [1, 2, 'approvals-binding'],
      [2, 2, 'device-row'],
    ]);
    expect(pres.every((p) => /^[0-9a-f]{12}$/.test(String(p.digest12)))).toBe(true);
    expect(presence.map((p) => p.digest12)).toEqual(pres.map((p) => p.digest12)); // the terminal sees the same digests
    expect((await call(ws, 7, 'setup.finish')).result).toEqual({ finished: true });
    expect(await ep.done).toEqual({ ok: true, home, provisioned: true });
  });

  it('G-SET-12: a second connection with the token is refused, and the reuse inside the TTL aborts and journals', async () => {
    const { ep, home } = rig();
    const g = await ep.start();
    const first = await attach(g);
    expect(first.auth.result).toMatchObject({ authenticated: true });
    const second = await attach(g);
    expect(reason(second.auth)).toBe('replayed-token');
    expect(await second.ws.closed()).toBe(1008);
    expect(await ep.done).toMatchObject({ ok: false, reason: 'token-reuse' });
    // Aegis L-B: no home yet ⇒ nothing is written (the terminal gets a notice instead)
    expect(fs.existsSync(home)).toBe(false);
  });

  it('G-SET-13: closing the socket mid-provisioning aborts at the next step and cleans up', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let closeNow!: () => void;
    const atCreate = new Promise<void>((r) => (closeNow = r));
    const { ep, home, fake } = rig({
      gate: async (r) => {
        if (r.op === 'key.create' && r.key === 'approvals') {
          closeNow();
          await held;
        }
      },
    });
    const g = await ep.start();
    const { ws } = await attach(g);
    await call(ws, 3, 'setup.preflight');
    await call(ws, 4, 'setup.name', { name: 'founder' });
    ws.sendJson(rpc(5, 'setup.begin', {}));
    await atCreate;
    ws.end();
    await new Promise((r) => setTimeout(r, 300));
    release();
    expect(await ep.done).toMatchObject({ ok: false, reason: 'socket-closed' });
    expect(fs.existsSync(identityPath(home))).toBe(false);
    expect([...fake.keys.keys()]).toEqual([]);
  });

  it('T-2026-10-19-006 (1): stop() removes the scratch dir while a step is still held on a prompt (Cmd-Q EOF)', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    let atCreate!: () => void;
    const reached = new Promise<void>((r) => (atCreate = r));
    const { ep } = rig({
      gate: async (r) => {
        if (r.op === 'key.create' && r.key === 'approvals') {
          atCreate();
          await held;
        }
      },
    });
    const g = await ep.start();
    const scratch = ep.scratchDir;
    expect(path.basename(scratch).startsWith('.gnomon-setup-')).toBe(true);
    expect(fs.existsSync(scratch)).toBe(true);
    const { ws } = await attach(g);
    await call(ws, 3, 'setup.preflight');
    await call(ws, 4, 'setup.name', { name: 'founder' });
    ws.sendJson(rpc(5, 'setup.begin', {}));
    await reached;
    const stopping = ep.stop();
    // the held step has not settled, yet the scratch is gone (the app kills the kernel at most 10 s after EOF)
    for (let i = 0; i < 100 && fs.existsSync(scratch); i++) await new Promise((r) => setTimeout(r, 20));
    expect(fs.existsSync(scratch)).toBe(false);
    release();
    await stopping;
    expect(await ep.done).toMatchObject({ ok: false, reason: 'stopped' });
  });

  it('touch-id: presence.available (helper 1.4.0, no prompt) makes the row pass or fail, never warn', async () => {
    for (const [touchId, status, ok] of [[true, 'pass', true], [false, 'fail', false]] as const) {
      const { ep } = rig({ fake: new FakeHelper(null, { touchId }) });
      const g = await ep.start();
      const { ws } = await attach(g);
      const r = (await call(ws, 3, 'setup.preflight')).result as { ok: boolean; checks: Array<{ id: string; status: string }> };
      expect(r.checks.find((c) => c.id === 'touch-id')?.status).toBe(status);
      expect(r.ok).toBe(ok);
      await ep.stop();
    }
  });

  /** Provision `home` straight through the engine over the same fake SE (optionally crashing at a step). */
  async function provisionDirect(fake: FakeHelper, home: string, fault?: string) {
    const r0 = rig({ fake });
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const p = new Provisioner({ home, helperPath: r0.exe, verifier: DEV, start: r0.start, once: () => (req) => fake.handle(req), ...(fault ? { fault: (st: string) => { if (st === fault) throw new Error('crash'); } } : {}) });
    return p.provision({ mode: 'init', existing: null, name: 'founder', host: 'mac-1' });
  }

  it('round 2 (a): purge, then begin, then exactly 2 root signs (#running is cleared after the purge)', async () => {
    const fake = new FakeHelper('oldgenoldgen');
    const { ep, home } = rig({ fake });
    const g = await ep.start();
    const { ws } = await attach(g);
    expect(((await call(ws, 3, 'setup.preflight')).result as { leftover: string[] }).leftover).toEqual(['oldgenoldgen']);
    expect(((await call(ws, 4, 'setup.purge', { gen: 'oldgenoldgen' })).result as { leftover: string[] }).leftover).toEqual([]);
    await call(ws, 5, 'setup.name', { name: 'founder' });
    const b = await call(ws, 6, 'setup.begin');
    expect(b.result).toMatchObject({ principalId: expect.stringMatching(/\/founder$/) });
    expect(fake.signs.filter((x) => x.key === 'root').length).toBe(2);
    expect(readIdentity(home)).not.toBeNull();
  });

  it('round 2 (b): a generation GNOMON_HOME lives on is never purged (in-use), and no key.delete happens', async () => {
    const fake = new FakeHelper(null);
    const other = path.join(tmp(), 'other-home');
    expect((await provisionDirect(fake, other)).ok).toBe(true);
    const gen = readIdentity(other)!.gen;
    const { ep, ops } = rig({ fake, alsoCheckHomes: [other] });
    const g = await ep.start();
    const { ws } = await attach(g);
    expect(((await call(ws, 3, 'setup.preflight')).result as { leftover: string[] }).leftover).toEqual([gen]);
    expect(reason(await call(ws, 4, 'setup.purge', { gen }))).toBe('in-use');
    expect(ops).not.toContain('key.delete');
    expect(ep.settled).toBe(false); // a refused purge does not end setup
    expect((await call(ws, 5, 'setup.preflight')).result).toBeTruthy();
  });

  it('round 2 (c): an interrupted setup (no registry row) is finished by setup.complete with 0 prompts; finish settles', async () => {
    const fake = new FakeHelper(null);
    const u = tmp();
    const home = path.join(u, '.gnomon');
    expect((await provisionDirect(fake, home, 'registry')).ok).toBe(false);
    const signsBefore = fake.signs.length;
    const { ep } = rig({ fake, userHome: u });
    const g = await ep.start();
    const { ws } = await attach(g);
    expect(((await call(ws, 3, 'setup.preflight')).result as { existing: unknown }).existing).toMatchObject({ registered: false });
    const cf = await call(ws, 4, 'setup.complete');
    if (!cf.result) throw new Error(JSON.stringify(cf.error));
    expect(cf.result).toMatchObject({ deviceId: readIdentity(home)!.deviceId });
    expect(fake.signs.length).toBe(signsBefore); // no new signature, no prompt
    await call(ws, 5, 'setup.finish');
    expect(await ep.done).toEqual({ ok: true, home, provisioned: true });
  });

  it('round 2 (c): a fully set-up home settles on finish (continue into up), it does not hang', async () => {
    const fake = new FakeHelper(null);
    const u = tmp();
    const home = path.join(u, '.gnomon');
    expect((await provisionDirect(fake, home)).ok).toBe(true);
    const { ep } = rig({ fake, userHome: u });
    const g = await ep.start();
    const { ws } = await attach(g);
    expect(((await call(ws, 3, 'setup.preflight')).result as { existing: unknown }).existing).toMatchObject({ registered: true });
    expect(reason(await call(ws, 4, 'setup.complete'))).toBe('nothing-to-complete');
    await call(ws, 5, 'setup.finish');
    expect(await ep.done).toEqual({ ok: true, home, provisioned: false });
  });

  it('round 2: an unused token expires and settles; an idle page settles; neither hangs', async () => {
    const a = rig({ ttlMs: 150 });
    await a.ep.start();
    expect(await a.ep.done).toMatchObject({ ok: false, reason: 'token-expired' });
    const b = rig({ idleMs: 200 });
    const g = await b.ep.start();
    await attach(g);
    expect(await b.ep.done).toMatchObject({ ok: false, reason: 'idle' });
  });

  it('round 2: a failed begin returns to the checks (setup continues); nothing was left', async () => {
    let fail = true;
    const { ep, home } = rig({ gate: (r) => { if (r.op === 'sign' && fail) { fail = false; throw new Error('helper crashed'); } } });
    const g = await ep.start();
    const { ws } = await attach(g);
    await call(ws, 3, 'setup.preflight');
    await call(ws, 4, 'setup.name', { name: 'founder' });
    const f = await call(ws, 5, 'setup.begin');
    expect(f.error).toBeTruthy();
    expect(ep.settled).toBe(false);
    expect(fs.existsSync(identityPath(home))).toBe(false);
    expect(((await call(ws, 6, 'setup.preflight')).result as { ok: boolean }).ok).toBe(true);
  });

  it('Aegis L5: hello params are an exact key set', async () => {
    const { ep } = rig();
    const g = await ep.start();
    const ws = await wsConnect(g.port);
    cleanups.push(() => ws.end());
    ws.sendJson(rpc(1, 'hello', { ...HELLO, extra: 1 }));
    await ws.nextJson();
    expect(await ws.closed()).toBe(1008);
  });

  it('round 2: the checks are read-only (no ~/.gnomon before begin); one helper fault is ONE FAIL row', async () => {
    const { ep, home } = rig({ gate: (r) => { if (r.op === 'key.list') throw new Error('helper down'); } });
    const g = await ep.start();
    const { ws } = await attach(g);
    const r = (await call(ws, 3, 'setup.preflight')).result as { checks: Array<{ id: string; status: string }> };
    expect(fs.existsSync(home)).toBe(false);
    expect(r.checks.filter((c) => c.status === 'fail').map((c) => c.id)).toEqual(['helper']);
    expect(r.checks.find((c) => c.id === 'touch-id')?.status).toBe('warn');
  });

  it('Aegis L-B: with the home present as a plain dir, a token reuse is journaled (never the token)', async () => {
    const u = tmp();
    const home = path.join(u, '.gnomon');
    fs.mkdirSync(home, { mode: 0o700 });
    const { ep } = rig({ userHome: u });
    const g = await ep.start();
    await attach(g);
    await attach(g);
    expect(await ep.done).toMatchObject({ reason: 'token-reuse' });
    const j = fs.readFileSync(identityJournalPath(home), 'utf8');
    expect(j).toContain('setup.token-reuse');
    expect(j).not.toContain(g.setupToken);
  });

  it('Aegis L-A: begin is capped at 2 attempts; the second failure ends setup and later calls say it was stopped', async () => {
    const { ep } = rig({ gate: (r) => { if (r.op === 'sign') throw new Error('helper crashed'); } });
    const g = await ep.start();
    const { ws } = await attach(g);
    await call(ws, 3, 'setup.preflight');
    await call(ws, 4, 'setup.name', { name: 'founder' });
    const f1 = await call(ws, 5, 'setup.begin');
    expect((f1.error as { data: { data: Record<string, unknown> } }).data.data).toMatchObject({ final: false, attemptsLeft: 1 });
    expect(ep.settled).toBe(false);
    const f2 = await call(ws, 6, 'setup.begin');
    expect((f2.error as { data: { data: Record<string, unknown> } }).data.data).toMatchObject({ final: true, attemptsLeft: 0 });
    expect(await ep.done).toMatchObject({ ok: false });
    expect(reason(await call(ws, 7, 'setup.preflight'))).toBe('setup-stopped');
  });

  it('Aegis L-C: the sweep removes only old, real, own .gnomon-setup-* dirs', () => {
    const d = tmp();
    const old = path.join(d, '.gnomon-setup-old');
    const fresh = path.join(d, '.gnomon-setup-new');
    const link = path.join(d, '.gnomon-setup-link');
    const file = path.join(d, '.gnomon-setup-file');
    fs.mkdirSync(old);
    fs.mkdirSync(fresh);
    fs.symlinkSync(old, link);
    fs.writeFileSync(file, 'x');
    const past = (Date.now() - SETUP_SCRATCH_MAX_AGE_MS - 60_000) / 1000;
    fs.utimesSync(old, past, past);
    fs.utimesSync(file, past, past);
    expect(sweepSetupScratch(d)).toEqual([old]);
    expect([fs.existsSync(fresh), fs.lstatSync(link).isSymbolicLink(), fs.existsSync(file)]).toEqual([true, true, true]);
  });
});

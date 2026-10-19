// @gnomon-platform: darwin, linux
/**
 * #socket + $daemon-lifecycle — the human-device verb `daemon.stop {reason?}` (P8-D98 verb 15, ruling
 * TD-2026-10-19-339, T-2026-10-19-014 B0), end to end over the unix socket of a real daemon on a dev home.
 * Falsifiers: the home's human device raises the daemon-stop card; approving it with fresh presence stops the
 * daemon (exit reason `stop`); an unknown reason is BAD_REQUEST and `upgrade` is ENGINE{not-implemented}, neither
 * raising a card; agent, session, mod, voice, read-token, peer and GUI launch-token connections are refused
 * FORBIDDEN{matrix} before the handler (no card); the web dispatcher reports daemon.stop unavailable; the handler
 * stamps connId from the connection, never from params; and `gnomon daemon stop` raises the card and exits 0
 * without waiting (no kernel: REFUSED ENGINE not-running).
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refusalOf } from '@a-company/gnomon-contracts';
import { approvalsKeyFrom, type ApprovalsKey } from '../src/kernel/broker/index.js';
import { selectSocketPath, startDaemon, type DaemonHandle } from '../src/kernel/lifecycle/index.js';
import { dispatcherOptionsFor } from '../src/kernel/lifecycle/daemon.js';
import { connectGnomon, createDaemonStopHandler, createKernelDispatcher, RpcRefusal, type HumanDeviceVerbPorts } from '../src/kernel/socket/index.js';
import { loadDevHome, provisionDevHome } from '../src/cli/dev-home.js';
import { recordKernelPub } from '../src/kernel/identity/index.js';
import { KeyRing, signaturePreimage } from '../src/kernel/log/signer.js';
import { mintTestPresence } from '../src/kernel/testing.js';
import { kernelPinOf, runDaemonCommand } from '../src/cli/daemon-cli.js';
import { humanDeviceOf } from '../src/cli/rules-cli.js';
import { GNOMON_VERSION } from '../src/version.js';
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanups.length) await cleanups.pop()!();
});

/** A dev home whose kernel pub is recorded, and an approvals key that signs after a (test) fresh presence. */
function world() {
  const t = tempHome('ds-');
  cleanups.push(t.cleanup);
  fs.mkdirSync(path.dirname(t.home), { recursive: true });
  const userHome = fs.realpathSync.native(path.dirname(t.home));
  const home = path.join(userHome, 'devhome');
  provisionDevHome(home, { userHome });
  const l = loadDevHome(home, { userHome });
  recordKernelPub(home, l.kernelKey.publicKeyPem);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ring = new KeyRing();
  const keyId = ring.addP256(publicKey);
  const prompts: string[] = [];
  const approvalsKey: ApprovalsKey = {
    ...approvalsKeyFrom(ring, (p) => (p === l.device.principalId ? keyId : undefined)),
    signDecision: async (req) => {
      prompts.push(req.mode);
      const decisionSig = cryptoSign('sha256', signaturePreimage('approve', req.message), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
      return { decisionSig, token: req.presence ? mintTestPresence(req.presence.purpose, { bind: req.presence.binding }) : null, kept: false };
    },
  };
  const sock = selectSocketPath({ home });
  if (!sock.ok) throw new Error('no socket path');
  return { home, l, approvalsKey, prompts, sock: sock.path };
}

async function humanConn(w: ReturnType<typeof world>) {
  const found = kernelPinOf(w.home, w.l.kernelKey.keyId)!;
  const device = humanDeviceOf(w.home);
  if (typeof device === 'string') throw new Error(device);
  const s = await connectGnomon({ socketPath: w.sock, client: { name: 'gnomon', version: GNOMON_VERSION, surface: 'cli' }, serverKey: found.pin, device });
  cleanups.push(() => s.conn.close().catch(() => undefined));
  return s;
}

const daemonStopCards = (d: DaemonHandle) =>
  [...d.log.read({ reader: { class: 'human' }, kinds: ['approval.request'] })].filter((v) => v.view === 'full' && (v.event.payload as { card?: { kind?: string } }).card?.kind === 'daemon-stop');

describe('daemon.stop over the unix socket, as the home human device', () => {
  it('raises the card; a second ask gets the same card; bad and reserved reasons raise none; a presence accept stops the daemon', async () => {
    const w = world();
    const d = await startDaemon({ home: w.home, idleMs: 60_000, kernelSigner: w.l.kernel, rootAuthority: w.l.root, approvalsKey: w.approvalsKey });
    cleanups.push(() => d.shutdown('signal').catch(() => undefined));
    const s = await humanConn(w);

    const bad = await s.conn.call('daemon.stop', { reason: 'reboot' } as never);
    expect('error' in bad && refusalOf(bad)).toMatchObject({ code: 'BAD_REQUEST', data: { reason: 'bad-params' } });
    const extra = await s.conn.call('daemon.stop', { reason: 'stop', connId: 'conn:01HZZZZZZZZZZZZZZZZZZZZZZQ' } as never);
    expect('error' in extra && refusalOf(extra)).toMatchObject({ code: 'BAD_REQUEST' });
    const up = await s.conn.call('daemon.stop', { reason: 'upgrade' });
    expect('error' in up && refusalOf(up)).toMatchObject({ code: 'ENGINE', data: { reason: 'not-implemented' } });
    expect(daemonStopCards(d)).toHaveLength(0);

    const r = await s.conn.call('daemon.stop', {});
    if ('error' in r) throw new Error(r.error.message);
    expect(r.result).toMatchObject({ state: 'pending' });
    const { cardId } = r.result;
    expect(cardId).toMatch(/^card:/);
    const again = await s.conn.call('daemon.stop', { reason: 'stop' });
    expect('result' in again && again.result.cardId).toBe(cardId);
    expect(daemonStopCards(d)).toHaveLength(1);

    let exited = false;
    void d.exited.then(() => (exited = true));
    const a = await s.conn.call('approve', { cardId, decision: 'accept' });
    if ('error' in a) throw new Error(a.error.message);
    expect(a.result).toMatchObject({ cardId, state: 'decided' });
    expect(w.prompts).toEqual(['fresh']); // one Touch ID prompt, never a cached unlock
    expect(await d.exited).toBe('stop');
    expect(exited).toBe(true);
  });

  it('`gnomon daemon stop` raises the card and exits 0 without waiting; with no kernel it is REFUSED ENGINE not-running', async () => {
    const w = world();
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((c: string | Uint8Array) => (out.push(String(c)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation((c: string | Uint8Array) => (err.push(String(c)), true));
    expect(await runDaemonCommand(['stop', '--home', w.home], '/nonexistent/gnomond.js')).not.toBe(0);
    expect(err.join('')).toContain('REFUSED  ENGINE  not-running');

    const d = await startDaemon({ home: w.home, idleMs: 60_000, kernelSigner: w.l.kernel, rootAuthority: w.l.root, approvalsKey: w.approvalsKey });
    cleanups.push(() => d.shutdown('signal').catch(() => undefined));
    err.length = 0;
    expect(await runDaemonCommand(['stop', '--home', w.home], '/nonexistent/gnomond.js')).toBe(0);
    vi.restoreAllMocks();
    expect(err.join('')).toBe('');
    const text = out.join('');
    expect(text).toMatch(/^CARD RAISED {2}card:/m);
    expect(text).toContain('approve it in Gnomon with Touch ID');
    expect(daemonStopCards(d)).toHaveLength(1);
    expect(w.prompts).toEqual([]); // nothing decided: the CLI does not wait
    let exited = false;
    void d.exited.then(() => (exited = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(exited).toBe(false); // the kernel keeps running until the card is accepted
  });
});

type Who = { kind: 'human' | 'agent' | 'session' | 'mod' | 'voice' | 'peer'; credential?: 'device' | 'gui' } | { kind: 'readToken' };

/** A dispatcher with the REAL daemon.stop handler on a recording port (as daemon.ts wires it). */
function dispatcherRig(transport: 'unix' | 'web') {
  const asked: Array<{ connId: string; reason: string }> = [];
  const humanVerbs: HumanDeviceVerbPorts = {
    'daemon.stop': createDaemonStopHandler({ requestStop: async (connId, reason) => (asked.push({ connId, reason }), { cardId: 'card:01J00000000000000000000000', state: 'pending' } as never) }),
  };
  const common = {
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial' as const, source: 'test' }), root: () => ({ state: 'dev-test' as const, rootKeyId: null }) },
    log: async () => undefined,
  };
  const d = createKernelDispatcher({
    ...dispatcherOptionsFor(transport, common, { humanVerbs }),
    authenticator: {
      now: () => Date.now(),
      checkToken: () => ({ ok: true }),
      authenticate: (s: Record<string, unknown>, p: { who: Who }) => {
        s.phase = 'authenticated';
        s.principal = 'p:local/x';
        if (p.who.kind === 'readToken') {
          Object.assign(s, { credential: 'read-token', tokenId: 'rtk:T', tokenExpiresAtMs: Date.now() + 60_000 });
          return { ok: true, credential: 'read-token', principal: 'p:local/x', tokenId: 'rtk:T', expiresAt: new Date(Date.now() + 60_000).toISOString() };
        }
        Object.assign(s, { principalKind: p.who.kind, deviceId: 'dev:local/mac', credential: p.who.credential ?? 'device' });
        if (p.who.credential === 'gui') return { ok: true, credential: 'gui', principal: 'p:local/x', deviceId: 'dev:local/mac', via: 'launch', guiToken: 'g', commit: () => undefined, abort: () => undefined };
        return { ok: true, credential: 'device', principal: 'p:local/x', principalKind: p.who.kind, deviceId: 'dev:local/mac', keyId: 'k' };
      },
    } as never,
  });
  let n = 0;
  const connect = async (who: Who) => {
    const ctx = { connId: `conn:test-${++n}`, closed: false, close() {}, authenticated() {}, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    await d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'auth', params: { who } }, ctx as never);
    return { connId: ctx.connId, call: (method: string, params: unknown = {}) => d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method, params }, ctx as never) };
  };
  return { connect, asked };
}

async function refusal(p: unknown): Promise<{ code: string; reason: unknown }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcRefusal) return { code: e.refusal.code, reason: e.refusal.data?.reason };
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('daemon.stop is a verified-human-device, unix-only verb', () => {
  it('agent, session, mod, voice, read-token, peer and GUI launch-token connections are FORBIDDEN{matrix}; no card is asked for', async () => {
    const r = dispatcherRig('unix');
    for (const who of [{ kind: 'agent' }, { kind: 'session' }, { kind: 'mod' }, { kind: 'voice' }, { kind: 'readToken' }, { kind: 'peer' }, { kind: 'human', credential: 'gui' }] as Who[]) {
      const c = await r.connect(who);
      expect(await refusal(c.call('daemon.stop', { reason: 'stop' })), JSON.stringify(who)).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    expect(r.asked).toEqual([]);
  });

  it('the human device connection reaches the port with ITS connId (a connId in params is refused, never used)', async () => {
    const r = dispatcherRig('unix');
    const c = await r.connect({ kind: 'human' });
    expect(await c.call('daemon.stop')).toEqual({ cardId: 'card:01J00000000000000000000000', state: 'pending' });
    expect(await refusal(c.call('daemon.stop', { connId: 'conn:other' }))).toEqual({ code: 'BAD_REQUEST', reason: 'bad-params' });
    expect(await refusal(c.call('daemon.stop', { reason: 7 }))).toEqual({ code: 'BAD_REQUEST', reason: 'bad-params' });
    expect(r.asked).toEqual([{ connId: c.connId, reason: 'stop' }]);
  });

  it('the web dispatcher reports daemon.stop unavailable and refuses it; the port is never reached', async () => {
    const r = dispatcherRig('web');
    const c = await r.connect({ kind: 'human' });
    const st = (await c.call('status')) as { humanDeviceVerbs: Array<{ verb: string; available: boolean }> };
    expect(st.humanDeviceVerbs.find((x) => x.verb === 'daemon.stop')?.available).toBe(false);
    expect(await refusal(c.call('daemon.stop'))).toEqual({ code: 'ENGINE', reason: 'not-implemented' });
    expect(r.asked).toEqual([]);
  });
});

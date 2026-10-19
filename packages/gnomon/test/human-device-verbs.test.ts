/**
 * #socket — P8-D98 (T-2026-10-19-001 A0): the human-device verbs `gui.open` and `rules.revoke`.
 * Falsifiers: every non-human principal (agent, session, mod, voice, read token, peer) is refused by the
 * registry tier; a human GUI launch-token connection is refused; a human device connection with no port
 * gets ENGINE{not-implemented}; a wired port is reached with the connection-stamped context; and the kernel
 * advertises no reserved hello feature (SERVER_FEATURES).
 */
import { describe, expect, it } from 'vitest';
import { HUMAN_DEVICE_VERBS, RESERVED_HELLO_FEATURES } from '@a-company/gnomon-contracts';
import { dispatcherOptionsFor } from '../src/kernel/lifecycle/daemon.js';
import { createKernelDispatcher, KERNEL_METHODS, RpcRefusal, SERVER_FEATURES, type HumanDeviceVerbPorts } from '../src/kernel/socket/index.js';

type Who = { kind: 'human' | 'agent' | 'session' | 'mod' | 'voice' | 'peer' | 'kernel'; credential?: 'device' | 'gui' | 'unset' } | { kind: 'readToken' };

function rig(humanVerbs?: HumanDeviceVerbPorts, transport?: 'unix' | 'web') {
  const common = {
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial' as const, source: 'test' }), root: () => ({ state: 'dev-test' as const, rootKeyId: null }) },
    log: async () => undefined,
  };
  const d = createKernelDispatcher({
    ...(transport ? dispatcherOptionsFor(transport, common, { humanVerbs: humanVerbs ?? {} }) : {}),
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
        Object.assign(s, { principalKind: p.who.kind, deviceId: 'dev:local/mac' }, p.who.credential === 'unset' ? {} : { credential: p.who.credential ?? 'device' });
        if (p.who.credential === 'gui') return { ok: true, credential: 'gui', principal: 'p:local/x', deviceId: 'dev:local/mac', via: 'launch', guiToken: 'g', commit: () => undefined, abort: () => undefined };
        return { ok: true, credential: 'device', principal: 'p:local/x', principalKind: p.who.kind, deviceId: 'dev:local/mac', keyId: 'k' };
      },
    } as never,
    status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: 'k', custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: null }) },
    log: async () => undefined,
    ...(!transport && humanVerbs ? { humanVerbs } : {}),
  });
  let n = 0;
  const connect = async (who: Who) => {
    const ctx = { connId: `conn:test-${++n}`, closed: false, close() {}, authenticated() {}, notify: () => true, writableLength: () => 0, writeHighWater: 1 << 16 };
    d.onConnect(ctx as never);
    await d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 1, method: 'auth', params: { who } }, ctx as never);
    return (method: string, params: unknown = {}) => d.handle({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: 2, method, params }, ctx as never);
  };
  return { d, connect };
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

const VERB_NAMES = HUMAN_DEVICE_VERBS.map((v) => v.verb);

describe('human-device verbs (P8-D98)', () => {
  it('are registered with a human tier only (deny by default for every other class)', () => {
    for (const v of VERB_NAMES) {
      expect(KERNEL_METHODS.has(v)).toBe(true);
      expect(KERNEL_METHODS.tier(v, 'human')).toBe('verified human device');
      for (const c of ['agent', 'session', 'mod', 'voice', 'readToken', 'peer']) expect(KERNEL_METHODS.tier(v, c)).toBe(false);
    }
  });
  it('refuse agent, session, mod, voice, read token and peer principals (FORBIDDEN matrix), port or not', async () => {
    const called: string[] = [];
    const { connect } = rig({ 'gui.open': async () => called.push('gui.open'), 'rules.revoke': async () => called.push('rules.revoke') });
    for (const who of [{ kind: 'agent' }, { kind: 'session' }, { kind: 'mod' }, { kind: 'voice' }, { kind: 'readToken' }, { kind: 'peer' }, { kind: 'kernel' }] as Who[]) {
      const call = await connect(who);
      for (const v of VERB_NAMES) expect(await refusal(call(v, { ruleId: 'card:x' })), `${who.kind} ${v}`).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
    }
    expect(called).toEqual([]);
  });
  it('refuse a human GUI launch-token connection (not a verified device)', async () => {
    const { connect } = rig({ 'gui.open': async () => 'x', 'rules.revoke': async () => 'x' });
    const call = await connect({ kind: 'human', credential: 'gui' });
    for (const v of VERB_NAMES) expect(await refusal(call(v))).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
  });
  it('Aegis L3: a human connection whose credential was never set is not a device (FORBIDDEN matrix), port or not', async () => {
    const called: string[] = [];
    const { connect } = rig({ 'gui.open': async () => called.push('gui.open'), 'rules.revoke': async () => called.push('rules.revoke') });
    const call = await connect({ kind: 'human', credential: 'unset' });
    for (const v of VERB_NAMES) expect(await refusal(call(v, { ruleId: 'card:x' })), v).toEqual({ code: 'FORBIDDEN', reason: 'matrix' });
    expect(called).toEqual([]);
  });
  it('a human device connection with no port gets ENGINE{not-implemented}', async () => {
    const { connect } = rig();
    const call = await connect({ kind: 'human' });
    for (const v of VERB_NAMES) expect(await refusal(call(v))).toEqual({ code: 'ENGINE', reason: 'not-implemented' });
  });
  it('a wired port is reached with the connection-stamped context', async () => {
    const seen: unknown[] = [];
    const { connect } = rig({ 'rules.revoke': async (ctx, p) => (seen.push({ principal: ctx.principal, deviceId: ctx.deviceId, p }), { revoked: true }) });
    const call = await connect({ kind: 'human' });
    expect(await call('rules.revoke', { ruleId: 'card:1' })).toEqual({ revoked: true });
    expect(seen).toEqual([{ principal: 'p:local/x', deviceId: 'dev:local/mac', p: { ruleId: 'card:1' } }]);
    expect(await refusal(call('gui.open'))).toEqual({ code: 'ENGINE', reason: 'not-implemented' });
  });
});

describe('human-device verbs are unix-socket only (Aegis L1, structural)', () => {
  it('the web dispatcher gets no human-verb port: status reports them unavailable and a call is refused, the port never reached', async () => {
    const called: string[] = [];
    const ports: HumanDeviceVerbPorts = { 'gui.open': async () => (called.push('gui.open'), {}), 'rules.revoke': async () => (called.push('rules.revoke'), {}), 'daemon.stop': async () => (called.push('daemon.stop'), {}) };
    const web = rig(ports, 'web');
    const wcall = await web.connect({ kind: 'human' });
    const st = (await wcall('status')) as { humanDeviceVerbs: Array<{ verb: string; available: boolean }> };
    for (const v of VERB_NAMES) expect(st.humanDeviceVerbs.find((x) => x.verb === v)?.available, v).toBe(false);
    for (const v of VERB_NAMES) expect(await refusal(wcall(v, { ruleId: 'card:x' }))).toEqual({ code: 'ENGINE', reason: 'not-implemented' });
    expect(called).toEqual([]);
    // the SAME ports on the unix dispatcher are available and reached
    const unix = rig(ports, 'unix');
    const ucall = await unix.connect({ kind: 'human' });
    const us = (await ucall('status')) as { humanDeviceVerbs: Array<{ verb: string; available: boolean }> };
    for (const v of VERB_NAMES) expect(us.humanDeviceVerbs.find((x) => x.verb === v)?.available, v).toBe(true);
    await ucall('gui.open');
    expect(called).toEqual(['gui.open']);
  });
});

describe('reserved hello features are not advertised', () => {
  it('SERVER_FEATURES advertises journal.cursor (built, slice A4) and not session.resume', () => {
    expect(RESERVED_HELLO_FEATURES).toContain('journal.cursor');
    expect(SERVER_FEATURES).toEqual(['journal.cursor']);
  });
});

/**
 * G-MOD-16 and G-MOD-17 at the socket (S1.3 P1; spec §11.5, §12.3): the gesture stamp a GUI connection carries on
 * `mod.command`, and what a relayed command may write.
 *
 * Two layers. The pure rule (socket/gesture.ts takeGesture) over plain connection objects, and the same rule over a
 * REAL GUI connection: the `gnomon-web` child, a WebSocket, a launch token, the real dispatcher, the real mod host
 * and two running probe mods (a `gnomon`-published one and a third-party one). The other caller classes hold device
 * keys on the unix socket: those cases are in test/mod-daemon.test.ts; the per-class table at the host is in
 * test/mod-stamp.test.ts. Uses the unsandboxed launcher seams; homes come from tempHome and the mod rig.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PrincipalKind } from '@a-company/gnomon-contracts';
import { UnprovisionedRootAuthority } from '../src/kernel/identity/index.js';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { createModKernelCall, createModRelayPort, type ModAppendRow } from '../src/kernel/modhost/index.js';
import { createKernelDispatcher, GESTURE_FANOUT, GESTURE_KINDS, RpcRefusal, SocketAuthenticator, takeGesture, type GestureConn } from '../src/kernel/socket/index.js';
import { createWebEndpointForTest, unsandboxedModLauncher } from '../src/kernel/testing.js';
import type { WebEndpoint } from '../src/kernel/web/index.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';
import { FIRST_PARTY_PROBE, host, install, installFirstParty, probeManifest, rig as modRig, writeModFolder } from './mod-helpers.js';
import { HELLO, rpc, wsConnect, type RawWs } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const human = (): GestureConn => ({ credential: 'gui', principalKind: 'human' });
const why = (f: () => unknown): string => {
  let err: unknown;
  try {
    f();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(RpcRefusal);
  const r = (err as RpcRefusal).refusal;
  expect([r.code, r.data?.reason, r.data?.verb]).toEqual(['FORBIDDEN', 'gesture', 'mod.command']);
  return String(r.data?.why);
};
const stamp = (n: unknown, kind: unknown = 'pointer', more: Record<string, unknown> = {}): Record<string, unknown> => ({ a: 1, gesture: { n, kind }, ...more });

describe('G-MOD-16: the gesture stamp (takeGesture, the pure rule)', () => {
  it('a well-formed stamp is spent and the returned args have no gesture key, no prototype and no prototype keys', () => {
    const conn = human();
    for (const kind of GESTURE_KINDS) {
      const args = JSON.parse(`{"a":1,"b":{"gesture":"kept: only the top-level key is the stamp"},"gesture":{"n":${GESTURE_KINDS.indexOf(kind) + 1},"kind":"${kind}"},"__proto__":{"evil":1},"constructor":2,"prototype":3}`) as Record<string, unknown>;
      const before = JSON.stringify(args);
      const out = takeGesture(conn, args);
      expect(Object.keys(out)).toEqual(['a', 'b']);
      expect(Object.getPrototypeOf(out)).toBeNull();
      expect(JSON.stringify(args)).toBe(before); // the caller's object is not mutated
    }
    expect(conn.gesture).toEqual({ n: 4, used: 1 });
    expect(GESTURE_KINDS).toEqual(['pointer', 'key', 'paste', 'menu']);
    expect(GESTURE_FANOUT).toBe(4);
  });

  it('missing: no args, args that are not a plain object, or no own gesture key', () => {
    const conn = human();
    for (const args of [null, undefined, 'x', 7, true, [], [stamp(1)], new Map(), new (class Args { gesture = { n: 1, kind: 'key' }; })()]) expect([args, why(() => takeGesture(conn, args))]).toEqual([args, 'args']);
    for (const args of [{}, { a: 1 }, { Gesture: { n: 1, kind: 'key' } }, { a: { gesture: { n: 1, kind: 'key' } } }]) expect([args, why(() => takeGesture(conn, args))]).toEqual([args, 'missing']);
    // a stamp reachable only through a prototype is not a stamp
    expect(why(() => takeGesture(conn, Object.create({ gesture: { n: 1, kind: 'key' } })))).toBe('args');
    expect(why(() => takeGesture(conn, JSON.parse('{"__proto__":{"gesture":{"n":1,"kind":"key"}}}')))).toBe('missing');
    expect(conn.gesture).toBeUndefined();
  });

  it('malformed: n is not a safe integer of at least 1, the kind is not in the closed list, or the stamp has another shape', () => {
    const conn = human();
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined, [1], { n: 1 }, true, 1n]) expect([String(n), why(() => takeGesture(conn, stamp(n)))]).toEqual([String(n), 'malformed']);
    for (const kind of ['touch', 'Pointer', '', 'pointer ', 'click', 'voice', 'agent', 7, null, ['key'], { kind: 'key' }]) expect([kind, why(() => takeGesture(conn, stamp(1, kind)))]).toEqual([kind, 'kind']);
    for (const g of [null, 1, 'key', [], [1, 'key'], {}, { n: 1 }, { kind: 'key' }, { n: 1, kind: 'key', at: 5 }, { n: 1, kind: 'key', human: true }, Object.create({ n: 1, kind: 'key' })]) expect([g, why(() => takeGesture(conn, { gesture: g }))]).toEqual([g, 'malformed']);
    // a refused stamp changes no state
    expect(conn.gesture).toBeUndefined();
    expect(Object.keys(takeGesture(conn, stamp(Number.MAX_SAFE_INTEGER, 'menu')))).toEqual(['a']);
    expect(conn.gesture).toEqual({ n: Number.MAX_SAFE_INTEGER, used: 1 });
  });

  it('repeated past the fan-out: the same n is allowed 4 times, the 5th is refused; a higher n starts again', () => {
    const conn = human();
    for (let i = 1; i <= GESTURE_FANOUT; i++) {
      takeGesture(conn, stamp(7, 'key'));
      expect(conn.gesture).toEqual({ n: 7, used: i });
    }
    for (let i = 0; i < 3; i++) expect(why(() => takeGesture(conn, stamp(7, 'key')))).toBe('spent');
    expect(conn.gesture).toEqual({ n: 7, used: GESTURE_FANOUT });
    // the kind is not part of the identity of a gesture: another kind on the same n is the same gesture
    expect(why(() => takeGesture(conn, stamp(7, 'paste')))).toBe('spent');
    takeGesture(conn, stamp(8, 'paste'));
    expect(conn.gesture).toEqual({ n: 8, used: 1 });
  });

  it('decreasing: an n below the last one seen is a replay, whatever its use count was', () => {
    const conn = human();
    takeGesture(conn, stamp(10));
    takeGesture(conn, stamp(12));
    for (const n of [11, 10, 1]) expect([n, why(() => takeGesture(conn, stamp(n)))]).toEqual([n, 'replayed']);
    expect(conn.gesture).toEqual({ n: 12, used: 1 });
    takeGesture(conn, stamp(12));
    expect(conn.gesture).toEqual({ n: 12, used: 2 });
  });

  it('non-human class: refused whatever the stamp, the credential or the claimed kind', () => {
    const kinds: Array<PrincipalKind | undefined> = ['agent', 'session', 'mod', 'voice', 'peer', 'kernel', undefined];
    for (const principalKind of kinds) {
      for (const credential of ['gui', 'device', undefined]) {
        const conn: GestureConn = { credential, principalKind };
        expect([principalKind, credential, why(() => takeGesture(conn, stamp(1)))]).toEqual([principalKind, credential, 'not-human']);
        expect(conn.gesture).toBeUndefined();
      }
    }
    // a read token is never the human class, whatever principal kind rides with it
    expect(why(() => takeGesture({ credential: 'read-token', principalKind: 'human' }, stamp(1)))).toBe('not-human');
  });

  it('state is bounded per connection: two numbers, however many stamps a connection sends; connections do not share it', () => {
    const a = human();
    const b = human();
    for (let n = 1; n <= 20_000; n++) takeGesture(a, stamp(n, GESTURE_KINDS[n % GESTURE_KINDS.length]));
    expect(Object.keys(a)).toEqual(['credential', 'principalKind', 'gesture']);
    expect(a.gesture).toEqual({ n: 20_000, used: 1 });
    expect(Object.keys(a.gesture!)).toEqual(['n', 'used']);
    // refusals grow nothing either
    for (let i = 0; i < 1_000; i++) why(() => takeGesture(a, stamp(i + 1)));
    expect(a.gesture).toEqual({ n: 20_000, used: 1 });
    expect(b.gesture).toBeUndefined();
    takeGesture(b, stamp(1));
    expect(b.gesture).toEqual({ n: 1, used: 1 });
  });
});

/* ── the same rule over a real GUI connection ─────────────────────────────── */

const HUMAN = { connId: 'conn:01JTESTASKER0000000000000', phase: 'authenticated' as const, credential: 'device' as const, principalKind: 'human' as const, principal: 'p:00000000/founder', deviceId: 'dev:00000000/mac-1' };
const LIVE = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZA';
const REPO = 'repo:0123456789abcdef';
const SOCKET_TEST_MS = 60_000;

interface Reply {
  result?: { result?: { relayedFor?: Record<string, string>; out?: { ok: boolean; keys?: string[]; hsid?: unknown; repo?: unknown; gesture?: unknown; args?: unknown } } };
  error?: { data?: { code?: string; data?: { reason?: string; why?: string } } };
}

/** The real dispatcher behind the real `gnomon-web` child, relaying to a real mod host that runs both probes. */
async function guiRig() {
  const r = modRig();
  cleanups.push(r.cleanup);
  install(r, writeModFolder(path.join(r.root, 'src', 'acme.probe'), probeManifest()));
  installFirstParty(r);
  const rows: ModAppendRow[] = [];
  const kernelCall = createModKernelCall({ callAs: async () => ({}), append: async (row) => (rows.push(row), { seq: rows.length }) });
  const { h } = host(r, { launcher: unsandboxedModLauncher }, { kernelCall, callTimeoutMs: 10_000, focusRepo: (hsid) => (hsid === LIVE ? REPO : null) });
  cleanups.push(() => h.stopAll());
  await h.start('acme.probe');
  await h.start(FIRST_PARTY_PROBE);

  const t = tempHome('gg-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  const kernel = SoftwareEd25519Signer.generate('kernel');
  const trust = new UnprovisionedRootAuthority();
  let ep!: WebEndpoint;
  ep = createWebEndpointForTest(
    {
      home: t.home,
      kernelPublicKeyPem: kernel.publicKeyPem,
      scriptPath: CHILD,
      log: async () => undefined,
      dispatcher: (endpointPath, web) =>
        createKernelDispatcher({
          authenticator: new SocketAuthenticator({ home: t.home, endpointPath, kernelSigner: kernel, trust }),
          web,
          mods: createModRelayPort(h),
          log: async () => undefined,
          status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'unprovisioned', rootKeyId: null }), web: () => ep.status() },
        }),
    },
    {},
  );
  cleanups.push(() => ep.stop('test'));

  /** One authenticated GUI connection (its own launch token), and a `mod.command` sender on it. */
  const gui = async () => {
    const grant = await ep.requestLaunch(HUMAN);
    const ws: RawWs = await wsConnect(ep.port);
    cleanups.push(() => ws.end());
    ws.sendJson(rpc(1, 'hello', HELLO('browser')));
    await ws.nextJson();
    ws.sendJson(rpc(2, 'auth', { launchToken: grant.launchToken }));
    const connId = ((await ws.nextJson()) as { result: { connId: string } }).result.connId;
    let id = 10;
    const command = async (name: string, args: unknown, more: Record<string, unknown> = {}): Promise<Reply> => {
      ws.sendJson(rpc(++id, 'mod.command', { name, commandId: 'probe.who', ...(args === undefined ? {} : { args }), ...more }));
      return (await ws.nextJson()) as Reply;
    };
    /** raw JSON params, so a key such as `__proto__` goes over the wire exactly as a hostile page would send it */
    const raw = async (paramsJson: string): Promise<Reply> => {
      ws.sendText(`{"jsonrpc":"2.0","rpc":"gnomon-rpc:v1","id":${++id},"method":"mod.command","params":${paramsJson}}`);
      return (await ws.nextJson()) as Reply;
    };
    return { ws, connId, command, raw };
  };
  return { h, rows, events: r.events, gui };
}

const refusedWhy = (f: Reply): unknown[] => [f.error?.data?.code, f.error?.data?.data?.reason, f.error?.data?.data?.why];

describe('G-MOD-16: the gesture stamp on a real GUI connection (WebSocket, launch token, real mod host)', () => {
  it(
    'missing, malformed, repeated past the fan-out and decreasing stamps are refused FORBIDDEN gesture and never reach the mod; a second connection has its own counter',
    async () => {
      const w = await guiRig();
      const a = await w.gui();
      const probe = (n: unknown, kind: unknown = 'pointer') => a.command(FIRST_PARTY_PROBE, { op: 'state.set', value: `n${String(n)}`, gesture: { n, kind } });
      // missing and malformed: the mod is never called, so its state never changes
      expect(refusedWhy(await a.command(FIRST_PARTY_PROBE, { op: 'state.set', value: 'no-stamp' }))).toEqual(['FORBIDDEN', 'gesture', 'missing']);
      expect(refusedWhy(await a.command(FIRST_PARTY_PROBE, undefined))).toEqual(['FORBIDDEN', 'gesture', 'args']);
      expect(refusedWhy(await a.command(FIRST_PARTY_PROBE, [{ gesture: { n: 1, kind: 'key' } }]))).toEqual(['FORBIDDEN', 'gesture', 'args']);
      expect(refusedWhy(await probe(0))).toEqual(['FORBIDDEN', 'gesture', 'malformed']);
      expect(refusedWhy(await probe('1'))).toEqual(['FORBIDDEN', 'gesture', 'malformed']);
      expect(refusedWhy(await probe(1, 'touch'))).toEqual(['FORBIDDEN', 'gesture', 'kind']);
      // a top-level gesture param is not the stamp (and the relay params are a contract: nothing new is read there)
      expect(refusedWhy(await a.command(FIRST_PARTY_PROBE, { op: 'state.set', value: 'top' }, { gesture: { n: 1, kind: 'key' } }))).toEqual(['FORBIDDEN', 'gesture', 'missing']);
      const state = async (): Promise<unknown> => ((await w.h.callTool(FIRST_PARTY_PROBE, 'probe.read', { op: 'state.get' })) as { v?: string }).v;
      const untouched = await state();
      // the same n fans out to 4 commands; the 5th is refused
      for (let i = 0; i < GESTURE_FANOUT; i++) expect((await probe(3)).result?.result?.out?.ok).toBe(true);
      expect(await state()).toBe(JSON.stringify('n3'));
      expect(await state()).not.toBe(untouched);
      expect(refusedWhy(await probe(3))).toEqual(['FORBIDDEN', 'gesture', 'spent']);
      // a higher n starts again; a lower one is a replay
      expect((await probe(4, 'menu')).result?.result?.out?.ok).toBe(true);
      expect(refusedWhy(await probe(3))).toEqual(['FORBIDDEN', 'gesture', 'replayed']);
      expect(refusedWhy(await probe(1))).toEqual(['FORBIDDEN', 'gesture', 'replayed']);
      expect(await state()).toBe(JSON.stringify('n4'));
      // the counter is per connection: another GUI connection starts from nothing, and does not move this one
      const b = await w.gui();
      expect(b.connId).not.toBe(a.connId);
      expect((await b.command(FIRST_PARTY_PROBE, { op: 'state.set', value: 'b1', gesture: { n: 1, kind: 'key' } })).result?.result?.out?.ok).toBe(true);
      expect(refusedWhy(await probe(1))).toEqual(['FORBIDDEN', 'gesture', 'replayed']);
      expect((await probe(5, 'paste')).result?.result?.out?.ok).toBe(true);
    },
    SOCKET_TEST_MS,
  );

  it(
    'the key never reaches a probe mod, first-party or third-party, and neither does any other host key a page sends',
    async () => {
      const w = await guiRig();
      const g = await w.gui();
      let n = 0;
      for (const name of [FIRST_PARTY_PROBE, 'acme.probe']) {
        const f = await g.raw(`{"name":"${name}","commandId":"probe.who","args":{"op":"args","keep":1,"gesture":{"n":${++n},"kind":"key"},"repo":"repo:evil","hsid":"hs-evil","focus":{"hsid":"hs-evil"},"paradigm":{"evil":1},"__proto__":{"gesture":{"n":9,"kind":"key"},"hsid":"hs-evil","evil":1},"constructor":{"evil":1},"prototype":{"evil":1}},"relayedFor":{"principal":"p:evil/x","surface":"cli"}}`);
        const res = f.result?.result;
        expect([name, res?.out?.keys]).toEqual([name, ['op', 'keep']]);
        expect([res?.out?.gesture, res?.out?.hsid, res?.out?.repo]).toEqual([null, null, null]);
        // relayedFor is the connection's, never the request's
        expect(res?.relayedFor).toEqual({ principal: HUMAN.principal, connId: g.connId, surface: 'gui' });
        expect(JSON.stringify(f).includes('evil')).toBe(false);
      }
      // the stamp is in no row either: a first-party append made under a stamped command holds only the host's stamp
      const f = await g.command(FIRST_PARTY_PROBE, { op: 'append.forged', gesture: { n: ++n, kind: 'pointer' } });
      expect(f.result?.result?.out?.ok).toBe(true);
      expect(w.rows).toHaveLength(1);
      expect(w.rows[0]!.payload).toEqual({ note: 'n', relayedFor: { principal: HUMAN.principal, connId: g.connId, surface: 'gui' } });
      expect(JSON.stringify(w.rows).includes('gesture')).toBe(false);
    },
    SOCKET_TEST_MS,
  );
});

describe('G-MOD-17: the command read cap on a real GUI connection', () => {
  it(
    'human on the GUI with a stamp: the first-party mod appends a row and sets state; the third-party mod is read-only (no row, no state)',
    async () => {
      const w = await guiRig();
      const g = await w.gui();
      let n = 0;
      const run = async (name: string, args: Record<string, unknown>): Promise<boolean | undefined> => (await g.command(name, { ...args, gesture: { n: ++n, kind: 'pointer' } })).result?.result?.out?.ok;
      const state = async (name: string): Promise<unknown> => ((await w.h.callTool(name, 'probe.read', { op: 'state.get' })) as { v?: string }).v;
      const acmeBefore = await state('acme.probe');
      expect([await run('acme.probe', { op: 'append.forged' }), await run('acme.probe', { op: 'state.set', value: 'acme' }), await run('acme.probe', { op: 'state.get' })]).toEqual([false, false, true]);
      expect(w.rows).toEqual([]);
      expect(await state('acme.probe')).toBe(acmeBefore);
      expect([await run(FIRST_PARTY_PROBE, { op: 'append.forged' }), await run(FIRST_PARTY_PROBE, { op: 'state.set', value: 'first' }), await run(FIRST_PARTY_PROBE, { op: 'state.get' })]).toEqual([true, true, true]);
      expect(w.rows).toHaveLength(1);
      expect(w.rows[0]).toMatchObject({ kind: 'modns.gnomon.probe.done', payload: { relayedFor: { principal: HUMAN.principal, connId: g.connId, surface: 'gui' } } });
      expect(await state(FIRST_PARTY_PROBE)).toBe(JSON.stringify('first'));
      expect(w.events.filter((e) => e.kind === 'mod.effect.refused').map((e) => e.payload.name)).toEqual(['acme.probe', 'acme.probe']);
    },
    SOCKET_TEST_MS,
  );

  it(
    'hsid and repo are composed for the first-party mod from the page\'s focus on a live session, and the row carries the repo scope; a third-party mod gets neither',
    async () => {
      const w = await guiRig();
      const g = await w.gui();
      let n = 0;
      const seen = async (name: string, args: Record<string, unknown>) => (await g.command(name, { ...args, gesture: { n: ++n, kind: 'menu' } })).result?.result?.out;
      expect(await seen(FIRST_PARTY_PROBE, { op: 'args', focus: { hsid: LIVE }, repo: 'repo:ffffffffffffffff' })).toMatchObject({ keys: ['op', 'hsid', 'repo'], hsid: LIVE, repo: REPO });
      expect(await seen(FIRST_PARTY_PROBE, { op: 'args', focus: { hsid: 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZB' } })).toMatchObject({ keys: ['op'], hsid: null, repo: null });
      expect(await seen('acme.probe', { op: 'args', focus: { hsid: LIVE } })).toMatchObject({ keys: ['op'], hsid: null, repo: null });
      await seen(FIRST_PARTY_PROBE, { op: 'append.forged', focus: { hsid: LIVE } });
      await seen(FIRST_PARTY_PROBE, { op: 'append.forged' });
      expect(w.rows.map((r) => r.scope)).toEqual([{ repo: REPO }, undefined]);
    },
    SOCKET_TEST_MS,
  );
});

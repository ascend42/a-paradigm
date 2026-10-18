// @gnomon-platform: darwin, linux
/**
 * #socket + #ref-resolver M1.4 slice 2 (spec §4.4, §4.9, §5, §9.3):
 * log.read pages and follow subscriptions, ref.resolve, and the G-ABI-02 rows
 * for status / log.read / ref.resolve across every principal class the
 * registry can construct (human, agent, session, mod, voice). Read tokens
 * (M1.4 slice 3) and the total matrix incl. peers: socket-abi.test.ts.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson, type EventV1, type HelloResult, type PrincipalKind } from '@a-company/gnomon-contracts';
import {
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  loadDeviceKey,
  readRegistry,
  registerDevice,
  registerKernelKey,
  RootVerifier,
  writeNewDeviceKey,
} from '../src/kernel/identity/index.js';
import { startDaemon, type DaemonHandle, type DaemonOptions } from '../src/kernel/lifecycle/index.js';
import { projectForReader, projectionStats, sha256TaggedFast, SoftwareEd25519Signer, type AnchorStore, type HeadAnchor, type LogView } from '../src/kernel/log/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { resolveRef } from '../src/kernel/refs/index.js';
import {
  connectGnomon,
  createKernelDispatcher,
  SocketAuthenticator,
  listenSocket,
  requestFrame,
  signAuth,
  SubscriptionHub,
  SUBSCRIPTION_BACKLOG_CAP,
  type ConnectionContext,
  type DeviceCredential,
  type GnomonSession,
  type RpcResponseFrame,
  type ServerKeyPin,
} from '../src/kernel/socket/index.js';
import { rawConnect, sleep, tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

const CLIENT = { name: 'gnomon-test', version: '0.0.0', surface: 'cli' };
const HSID = 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0';
const SHA = `sha256:${'a'.repeat(64)}`;

interface Rig {
  home: string;
  d: DaemonHandle;
  pin: ServerKeyPin;
  cred: DeviceCredential;
}

async function rig(kind: PrincipalKind = 'human', name = 'founder', daemon: Partial<DaemonOptions> = {}): Promise<Rig> {
  const t = tempHome('gr-');
  cleanups.push(t.cleanup);
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  const kernel = SoftwareEd25519Signer.generate('kernel');
  registerKernelKey(t.home, root, kernel.publicKeyPem);
  const devKey = writeNewDeviceKey(t.home);
  const entry = registerDevice(t.home, root, { host: 'mac-1', name, publicKeyPem: devKey.publicKeyPem, principalKind: kind });
  const d = await startDaemon({ home: t.home, idleMs: 60_000, kernelSigner: kernel, rootAuthority: root, ...daemon });
  cleanups.push(() => d.shutdown('signal'));
  const reg = readRegistry(t.home, new RootVerifier(root.publicKeyPem));
  return { home: t.home, d, pin: { keyId: kernel.keyId, publicKeyPem: reg.kernelKeys.get(kernel.keyId)! }, cred: { principalId: entry.principalId, deviceId: entry.deviceId, signer: loadDeviceKey(t.home) } };
}

async function session(r: Rig): Promise<GnomonSession> {
  const s = await connectGnomon({ socketPath: r.d.pidfile.socketPath, client: CLIENT, serverKey: r.pin, device: r.cred });
  cleanups.push(() => s.conn.close());
  return s;
}

/** hello + auth over a raw socket (so the test can pause reading). */
async function rawAuthed(r: Rig) {
  const c = await rawConnect(r.d.pidfile.socketPath);
  cleanups.push(() => c.close());
  c.send(requestFrame(1, 'hello', { clientApis: ['gnomon-rpc:v1'], features: [], client: CLIENT }));
  const [h] = await c.next(1);
  const hello = (h as { result: HelloResult }).result;
  c.send(requestFrame(2, 'auth', { principal: r.cred.principalId, deviceId: r.cred.deviceId, sig: signAuth(r.cred, hello, r.d.pidfile.socketPath) }));
  const [a] = await c.next(1);
  expect(a).toMatchObject({ result: { principal: r.cred.principalId } });
  return c;
}

const K = (r: Rig) => r.d.kernelPrincipal;
type Res = Record<string, unknown>;
const ok = (f: RpcResponseFrame): Res => {
  if ('error' in f) throw new Error(`refused: ${JSON.stringify(f.error)}`);
  return f.result as Res;
};
const errOf = (f: RpcResponseFrame) => ('error' in f ? { code: f.error.code, c: f.error.data.code, reason: f.error.data.data?.reason, milestone: f.error.data.data?.milestone } : { result: true });

function firstEventId(r: Rig): string {
  const v = [...r.d.log.read({ reader: { class: 'human' }, limit: 1 })][0]!;
  return (v as { event: EventV1 }).event.id;
}

/* ── G-ABI-02: status / log.read / ref.resolve × principal class ─────────── */

describe('G-ABI-02 rows: status, log.read, ref.resolve for every constructible principal class', () => {
  it('human, agent, session, mod, voice — served, scoped or refused exactly as §5/§9.3 say; peer/read token noted', async () => {
    const cases: Array<[PrincipalKind, string]> = [
      ['human', 'founder'],
      ['agent', 'builder'],
      ['session', 'sess-1'],
      ['mod', 'mod-workshop'],
      ['voice', 'voice'],
    ];
    const table: Record<string, unknown> = {};
    for (const [kind, name] of cases) {
      const r = await rig(kind, name);
      const s = await session(r);
      const ev = firstEventId(r);
      const st = await s.conn.call('status', {});
      const lr = await s.conn.call('log.read', {});
      const rr = await s.conn.call('ref.resolve', { ref: ev });
      const rs = await s.conn.call('ref.resolve', { ref: 'sym:#socket' });
      table[kind] = {
        status: 'result' in st ? 'served' : errOf(st),
        logRead: 'result' in lr ? `served:${(lr.result as Res).projection}` : errOf(lr),
        refEv: 'result' in rr ? `served:${((rr.result as Res).target as LogView).view}` : errOf(rr),
        refSym: errOf(rs),
      };
    }
    const noResolver = { code: -32005, c: 'UNSUPPORTED', reason: 'no-resolver', milestone: undefined };
    expect(table).toEqual({
      human: { status: 'served', logRead: 'served:community-client', refEv: 'served:full', refSym: noResolver },
      agent: {
        status: 'served',
        logRead: { code: -32005, c: 'UNSUPPORTED', reason: 'reader-unsupported', milestone: 'Move 2' },
        refEv: { code: -32005, c: 'UNSUPPORTED', reason: 'reader-unsupported', milestone: 'Move 2' },
        refSym: noResolver,
      },
      session: {
        status: 'served',
        logRead: { code: -32000, c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.7' },
        refEv: { code: -32000, c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.7' },
        refSym: noResolver,
      },
      // mod: status is 'own view' (M1.11); log.read = own modns + granted kinds; a kernel row is NOT_FOUND
      mod: {
        status: { code: -32000, c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.11' },
        logRead: 'served:mod',
        refEv: { code: -32004, c: 'NOT_FOUND', reason: 'not-found', milestone: undefined },
        refSym: noResolver,
      },
      voice: {
        status: 'served',
        logRead: { code: -32005, c: 'UNSUPPORTED', reason: 'reader-unsupported', milestone: 'Move 4' },
        refEv: { code: -32005, c: 'UNSUPPORTED', reason: 'reader-unsupported', milestone: 'Move 4' },
        refSym: noResolver,
      },
    });
  }, 30_000);

  it('status advertises log.read / ref.resolve as available and reports subscriptions', async () => {
    const r = await rig();
    const s = await session(r);
    const st = ok(await s.conn.call('status', {}));
    const verbs = st.verbs as Array<{ verb: string; available: boolean }>;
    expect(verbs.filter((v) => v.available).map((v) => v.verb)).toEqual(['status', 'session.open', 'session.send', 'session.stop', 'log.read', 'permit.reserve', 'approve', 'ref.resolve']); // approve + permit.reserve served since M1.6; session.* for the human since M1.7 slice 1
    expect(st.subscriptions).toEqual({ n: 0, onThisConnection: 0, perConnectionMax: 8, backlogCap: SUBSCRIPTION_BACKLOG_CAP });
  });
});

/* ── §9.3 redaction per class ─────────────────────────────────────────────── */

async function seedSensitive(r: Rig): Promise<Record<string, number>> {
  const L = r.d.log;
  const seqs: Record<string, number> = {};
  seqs.inject = (await L.append({ kind: 'session.inject', principal: K(r), session: HSID, payload: { origin: 'client', hash: SHA, bytes: 3 } })).seq;
  seqs.request = (await L.append({ kind: 'approval.request', principal: K(r), session: HSID, payload: { cardId: 'c1', tool_input: 'MARK-tool-input' } })).seq;
  seqs.auto = (await L.append({ kind: 'approval.auto', principal: K(r), payload: { path: 'MARK-path', class: 'edit' } })).seq;
  seqs.reverted = (await L.append({ kind: 'merge.reverted', principal: K(r), payload: { trailer: 'MARK-trailer', sha: 'abc' } })).seq;
  seqs.oracle = (await L.append({ kind: 'oracle.result', principal: K(r), payload: { pass: true, evidence: 'MARK-evidence' } })).seq;
  seqs.sensitive = (await L.append({ kind: 'config.prefs', principal: K(r), sensitivity: 'sensitive', payload: { note: 'MARK-sensitive-row' } })).seq;
  seqs.secret = (await L.append({ kind: 'config.prefs', principal: K(r), sensitivity: 'secret', payload: { note: 'MARK-secret-row' } })).seq;
  seqs.normal = (await L.append({ kind: 'config.prefs', principal: K(r), payload: { note: 'plain' } })).seq;
  return seqs;
}

describe('§9.3 redaction matrix over the socket (G-ABI-05 rows reachable in M1.4)', () => {
  it('human (no first-party proof) gets the community-client row: stubs, field redaction, no sensitive/secret rows, no raw marker anywhere', async () => {
    const r = await rig();
    const seqs = await seedSensitive(r);
    const s = await session(r);
    const res = ok(await s.conn.call('log.read', { limit: 1000 }));
    expect(res.projection).toBe('community-client');
    expect(res.fullView).toMatchObject({ needs: expect.stringContaining('log.read:sensitive') });
    const rows = res.rows as LogView[];
    const bySeq = new Map(rows.map((v) => [v.seq, v]));
    expect(bySeq.get(seqs.inject)).toEqual({ seq: seqs.inject, view: 'stub', stub: { kind: 'session.inject', hsid: HSID, at: expect.any(String) } });
    for (const [k, field] of [['request', 'tool_input'], ['auto', 'path'], ['reverted', 'trailer'], ['oracle', 'evidence']] as const) {
      const v = bySeq.get(seqs[k]!) as { view: string; event: EventV1 };
      expect(v.view).toBe('full');
      expect((v.event.payload as Res)[field]).toEqual({ redacted: true });
    }
    expect(bySeq.has(seqs.sensitive)).toBe(false);
    expect(bySeq.has(seqs.secret)).toBe(false);
    expect(bySeq.get(seqs.normal)).toMatchObject({ view: 'full' });
    expect(JSON.stringify(res)).not.toMatch(/MARK-/);
    // ref.resolve projects the same way
    const reqId = ((bySeq.get(seqs.request) as { event: EventV1 }).event).id;
    const rr = ok(await s.conn.call('ref.resolve', { ref: reqId }));
    expect(JSON.stringify(rr)).not.toMatch(/MARK-/);
    expect(rr).toMatchObject({ ref: reqId, target: { view: 'full' } });
    expect(Object.hasOwn(rr, 'hash')).toBe(false); // limited reader: no hash from ref.resolve either
    const injId = [...r.d.log.read({ reader: { class: 'human' }, fromSeq: seqs.inject, toSeq: seqs.inject })][0] as { event: EventV1 };
    expect(ok(await s.conn.call('ref.resolve', { ref: injId.event.id }))).toMatchObject({ target: { view: 'stub' } });
    const secretId = ([...r.d.log.read({ reader: { class: 'human' }, fromSeq: seqs.secret, toSeq: seqs.secret })][0] as { event: EventV1 }).event.id;
    expect(errOf(await s.conn.call('ref.resolve', { ref: secretId }))).toMatchObject({ c: 'NOT_FOUND', reason: 'not-found' });
  });

  it('mod sees none of the kernel rows (own modns + granted kinds only); a mod principal not named mod-<name> is FORBIDDEN', async () => {
    const r = await rig('mod', 'mod-workshop');
    await seedSensitive(r);
    const s = await session(r);
    const res = ok(await s.conn.call('log.read', { limit: 1000 }));
    expect(res).toMatchObject({ projection: 'mod', rows: [] });
    expect(res.next).toBe(r.d.log.head().seq); // scanned to the head, returned nothing
    const r2 = await rig('mod', 'workshop');
    const s2 = await session(r2);
    expect(errOf(await s2.conn.call('log.read', {}))).toMatchObject({ c: 'FORBIDDEN', reason: 'mod-principal-name' });
  });

  it('labels never widen: a lowered envelope label, a payload sensitivity/fieldLabels key, an unknown label and a stored column label are all ignored or tightening', () => {
    const base = { schemaVersion: 'event:v1', log: 'log:x', at: '2026-10-17T00:00:00.000Z', principal: 'p:x/kernel', audience: 'private', prev: SHA, hash: SHA } as unknown as EventV1;
    const inj = { ...base, id: 'ev:1', seq: 1, kind: 'session.inject', session: HSID, sensitivity: 'normal', payload: { origin: 'client', hash: SHA, bytes: 1 } } as EventV1;
    expect(projectForReader(inj, { class: 'community-client' })).toMatchObject({ view: 'stub' });
    const req = { ...base, id: 'ev:2', seq: 2, kind: 'approval.request', sensitivity: 'normal', payload: { tool_input: 'X', sensitivity: 'normal', fieldLabels: {} } } as unknown as EventV1;
    const v = projectForReader(req, { class: 'read-token' }) as { event: EventV1 };
    expect((v.event.payload as Res).tool_input).toEqual({ redacted: true });
    const unk = { ...base, id: 'ev:3', seq: 3, kind: 'config.prefs', sensitivity: 'bogus', payload: {} } as unknown as EventV1;
    expect(projectForReader(unk, { class: 'read-token' })).toBeUndefined(); // unknown label ranks secret
    const norm = { ...base, id: 'ev:4', seq: 4, kind: 'config.prefs', sensitivity: 'normal', payload: {} } as EventV1;
    expect(projectForReader(norm, { class: 'community-client' }, 'sensitive')).toBeUndefined();
    expect(projectForReader(norm, { class: 'read-token' }, 'secret')).toBeUndefined();
    expect(projectForReader(norm, { class: 'mod', name: 'x', grantedKinds: ['config.prefs'] }, 'sensitive')).toBeUndefined();
    expect(projectForReader(norm, { class: 'community-client' })).toMatchObject({ view: 'full' });
  });

  it('at-rest tamper: a lowered envelope label fails the re-hash and is withheld from every reader; a lowered column label cannot widen', async () => {
    const r = await rig();
    const seqs = await seedSensitive(r);
    const db = new DatabaseSync(path.join(r.home, 'kernel.db'));
    try {
      db.exec('DROP TRIGGER chain_no_update');
      db.prepare(`UPDATE chain SET envelope = replace(envelope, '"sensitivity":"secret"', '"sensitivity":"normal"'), sensitivity = 'normal' WHERE seq = ?`).run(seqs.secret);
      db.prepare(`UPDATE chain SET sensitivity = 'normal' WHERE seq = ?`).run(seqs.sensitive);
    } finally {
      db.close();
    }
    const s = await session(r);
    const res = ok(await s.conn.call('log.read', { limit: 1000 }));
    const seen = (res.rows as LogView[]).map((v) => v.seq);
    expect(seen).not.toContain(seqs.secret);
    expect(seen).not.toContain(seqs.sensitive);
    expect(res.withheld).toBe(1);
    expect(JSON.stringify(res)).not.toMatch(/MARK-/);
    const raw = new DatabaseSync(path.join(r.home, 'kernel.db'), { readOnly: true });
    const evId = (raw.prepare('SELECT id FROM chain WHERE seq = ?').get(seqs.secret) as { id: string }).id;
    raw.close();
    expect(errOf(await s.conn.call('ref.resolve', { ref: evId }))).toMatchObject({ c: 'ENGINE', reason: 'row-integrity' });
  });
});

/* ── pages ────────────────────────────────────────────────────────────────── */

describe('log.read pages', () => {
  it('cursor pagination is stable while rows are appended between pages; filters by kind, ns.* and scope.hsid', async () => {
    const r = await rig();
    for (let i = 0; i < 250; i++) await r.d.log.append({ kind: 'config.prefs', principal: K(r), payload: { i }, ...(i % 2 ? { session: HSID } : {}) });
    const s = await session(r);
    const got: number[] = [];
    let since = 0;
    let extra = 0;
    for (let guard = 0; guard < 50; guard++) {
      const page = ok(await s.conn.call('log.read', { since, limit: 40, kinds: ['config.prefs'] }));
      const rows = page.rows as LogView[];
      expect(rows.length).toBeLessThanOrEqual(40);
      got.push(...rows.map((v) => v.seq));
      since = page.next as number;
      if (extra < 60) {
        for (let i = 0; i < 20; i++) await r.d.log.append({ kind: 'config.prefs', principal: K(r), payload: { late: extra++ } });
      }
      if (page.caughtUp && rows.length === 0) break;
    }
    const all = [...r.d.log.read({ reader: { class: 'community-client' }, kinds: ['config.prefs'] })].map((v) => v.seq);
    expect(got).toEqual(all); // no dupes, no gaps, seq order
    expect(all.length).toBe(310);
    const ns = ok(await s.conn.call('log.read', { kinds: ['socket.*'], limit: 1000 }));
    expect((ns.rows as Array<{ event: EventV1 }>).every((v) => v.event.kind.startsWith('socket.'))).toBe(true);
    expect((ns.rows as unknown[]).length).toBeGreaterThan(0);
    const sc = ok(await s.conn.call('log.read', { kinds: ['config.prefs'], scope: { hsid: HSID }, limit: 1000 }));
    expect((sc.rows as unknown[]).length).toBe(125);
  });

  it('bad params are BAD_REQUEST: limit, since, until, kinds, scope, follow', async () => {
    const r = await rig();
    const s = await session(r);
    const head = r.d.log.head().seq;
    const cases: Array<[unknown, string]> = [
      [{ limit: 0 }, 'bad-limit'],
      [{ limit: 1001 }, 'bad-limit'],
      [{ since: -1 }, 'bad-since'],
      [{ since: 1.5 }, 'bad-since'],
      [{ since: head + 5 }, 'since-ahead'],
      [{ since: 3, until: 2 }, 'bad-until'],
      [{ kinds: [] }, 'bad-kinds'],
      [{ kinds: ['Bad Kind'] }, 'bad-kinds'],
      [{ scope: { hsid: 'nope' } }, 'bad-scope'],
      [{ scope: [] }, 'bad-scope'],
      [{ follow: 'yes' }, 'bad-follow'],
      [[], 'bad-params'],
    ];
    for (const [p, reason] of cases) expect(errOf(await s.conn.call('log.read', p))).toMatchObject({ code: -32600, reason });
  });
});

/* ── ref.resolve ──────────────────────────────────────────────────────────── */

describe('ref.resolve (#ref-resolver)', () => {
  it('happy ev:, unknown event, malformed, rev, dropped/unknown/peer/package schemes, not-yet built-ins with milestones', async () => {
    const r = await rig();
    const s = await session(r);
    const id = firstEventId(r);
    expect(ok(await s.conn.call('ref.resolve', { ref: id }))).toMatchObject({ ref: id, target: { view: 'full', event: { id, kind: 'daemon.start' } } });
    const table: Record<string, unknown> = {};
    for (const ref of [
      'ev:01JABCDEFGHJKMNPQRSTVWXYZ0',
      'ev:nope',
      `${id}@2`,
      'voice:abc',
      'zzz:abc',
      'no-colon',
      'peer:log:01JABCDEFGHJKMNPQRSTVWXYZ0/ev:01JABCDEFGHJKMNPQRSTVWXYZ0',
      '#socket',
      'td:TD-1',
      `turn:${HSID}/3`,
      `turn:${HSID}/0`,
      HSID,
      'hsid:nope',
      'card:x',
      'permit:x',
      'gkey:x',
      'contract:x',
      'x'.repeat(600),
    ]) {
      table[ref.slice(0, 40)] = errOf(await s.conn.call('ref.resolve', { ref }));
    }
    expect(errOf(await s.conn.call('ref.resolve', {}))).toMatchObject({ c: 'BAD_REQUEST', reason: 'bad-ref' });
    expect(table).toMatchObject({
      'ev:01JABCDEFGHJKMNPQRSTVWXYZ0': { c: 'NOT_FOUND', reason: 'not-found' },
      'ev:nope': { c: 'BAD_REQUEST', reason: 'bad-ref' },
      [`${id}@2`.slice(0, 40)]: { c: 'BAD_REQUEST', reason: 'rev-not-applicable' },
      'voice:abc': { c: 'BAD_REQUEST', reason: 'bad-ref' },
      'zzz:abc': { c: 'UNSUPPORTED', reason: 'unknown-scheme' },
      'no-colon': { c: 'BAD_REQUEST', reason: 'bad-ref' },
      'peer:log:01JABCDEFGHJKMNPQRSTVWXYZ0/ev:0': { c: 'UNSUPPORTED', reason: 'peer-ref' },
      '#socket': { c: 'UNSUPPORTED', reason: 'no-resolver' },
      'td:TD-1': { c: 'UNSUPPORTED', reason: 'no-resolver' },
      [`turn:${HSID}/3`.slice(0, 40)]: { c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.7' },
      [`turn:${HSID}/0`.slice(0, 40)]: { c: 'BAD_REQUEST', reason: 'bad-ref' },
      [HSID]: { c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.7' },
      'hsid:nope': { c: 'BAD_REQUEST', reason: 'bad-ref' },
      'card:x': { c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.6' },
      'permit:x': { c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.6' },
      'gkey:x': { c: 'ENGINE', reason: 'not-implemented', milestone: 'M1.3' },
      'contract:x': { c: 'ENGINE', reason: 'not-implemented', milestone: 'M2.1' },
      ['x'.repeat(40)]: { c: 'BAD_REQUEST', reason: 'bad-ref' },
    });
  });

  it('the reader is consulted only for a lookup (no-resolver answers need no projection)', () => {
    let asked = 0;
    const out = resolveRef({ ref: 'sym:#socket' }, { getById: () => undefined }, () => (asked++, { class: 'human' }));
    expect(out).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(asked).toBe(0);
  });
});

/* ── subscriptions ────────────────────────────────────────────────────────── */

describe('log.read{follow} subscriptions (§4.9)', () => {
  it('the reply is written before the first event notification (ctx.afterReply)', async () => {
    const t = tempHome('gs-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const srv = await listenSocket({
      socketPath: path.join(t.home, 's.sock'),
      handle: (_f, ctx: ConnectionContext) => {
        ctx.afterReply(() => ctx.notify('event', { n: 1 }));
        return { subscription: 'sub:x' };
      },
    });
    cleanups.push(() => srv.close());
    const c = await rawConnect(srv.socketPath);
    cleanups.push(() => c.close());
    c.send(requestFrame(7, 'log.read', { follow: true }));
    const frames = await c.next(2);
    expect(frames[0]).toMatchObject({ id: 7, result: { subscription: 'sub:x' } });
    expect(frames[1]).toMatchObject({ method: 'event', params: { n: 1 } });
    expect(Object.hasOwn(frames[1]!, 'id')).toBe(false);
  });

  it('backlog then live rows arrive in seq order, filtered and projected; the subscription holds and releases with its connection', async () => {
    const r = await rig();
    await seedSensitive(r);
    const s = await session(r);
    const events: Array<{ subscription: string; row: LogView }> = [];
    s.conn.onNotification((m, p) => m === 'event' && events.push(p as never));
    const sub = ok(await s.conn.call('log.read', { follow: true, kinds: ['config.prefs', 'session.inject', 'approval.request'] }));
    expect(sub).toMatchObject({ subscription: expect.stringMatching(/^sub:/), since: 0, projection: 'community-client', backlogCap: 10_000 });
    for (let i = 0; i < 300; i++) await r.d.log.append({ kind: 'config.prefs', principal: K(r), payload: { i } });
    await r.d.log.append({ kind: 'config.prefs', principal: K(r), sensitivity: 'secret', payload: { note: 'MARK-live-secret' } });
    await r.d.log.append({ kind: 'daemon.reexec', principal: K(r), payload: {} }); // filtered out by kinds
    const want = [...r.d.log.read({ reader: { class: 'community-client' }, kinds: ['config.prefs', 'session.inject', 'approval.request'] })].map((v) => v.seq);
    for (let i = 0; i < 300 && events.length < want.length; i++) await sleep(10);
    expect(events.map((e) => e.row.seq)).toEqual(want);
    expect(events.every((e) => e.subscription === sub.subscription)).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(/MARK-/);
    expect(ok(await s.conn.call('status', {})).subscriptions).toMatchObject({ n: 1, onThisConnection: 1 });
    expect(r.d.subscriptions().active).toBe(1);
    await s.conn.close();
    for (let i = 0; i < 100 && r.d.subscriptions().active > 0; i++) await sleep(10);
    expect(r.d.subscriptions().active).toBe(0);
  });

  it('hub unit: drop beyond the cap with a final end frame and a deferred onDropped; idle hold released; drain resumes a paused pump', async () => {
    const t = tempHome('gh-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const log = openKernelLog({ home: t.home, kernelPrincipal: 'p:abcdefgh/kernel', signer: SoftwareEd25519Signer.generate() });
    cleanups.push(async () => void (await log.close()));
    const holds = { n: 0 };
    const dropped: Array<{ connId: string; payload: Res }> = [];
    const hub = new SubscriptionHub({ log, backlogCap: 50, holdIdle: () => (holds.n++, () => void holds.n--), onDropped: (connId, payload) => dropped.push({ connId, payload }) });
    cleanups.push(() => hub.close());
    const mk = (connId: string) => {
      const st = { buffered: 0, frames: [] as Res[], drains: [] as Array<() => void>, after: [] as Array<() => void> };
      const ctx: ConnectionContext = {
        connId,
        closed: false,
        close: () => undefined,
        authenticated: () => undefined,
        notify: (_m, p) => (st.frames.push(p as Res), (st.buffered += 1000), true),
        writableLength: () => st.buffered,
        writeHighWater: 5_000,
        onDrain: (fn) => (st.drains.push(fn), () => void (st.drains = st.drains.filter((f) => f !== fn))),
        afterReply: (fn) => void st.after.push(fn),
      };
      return { st, ctx };
    };
    const grant = { reader: { class: 'community-client' as const }, projection: 'community-client' };
    const p = { since: log.head().seq, limit: 256, follow: true, kinds: (k: string) => k === 'config.prefs' };
    // A: slow reader — buffer stays over the high-water mark
    const a = mk('conn:A');
    hub.subscribe(a.ctx, grant, p);
    a.st.after.forEach((f) => f());
    expect(holds.n).toBe(1);
    for (let i = 0; i < 10; i++) await log.append({ kind: 'config.prefs', principal: 'p:abcdefgh/kernel', payload: { i } });
    await sleep(20);
    expect(a.st.frames.length).toBe(6); // 5 000 bytes high-water / 1 000 per frame: stops once over
    for (let i = 0; i < 60; i++) await log.append({ kind: 'config.prefs', principal: 'p:abcdefgh/kernel', payload: { i } });
    await sleep(5);
    expect(hub.stats()).toMatchObject({ dropped: 1, active: 0 });
    expect(hub.stats().maxLag).toBe(51);
    expect(a.st.frames.at(-1)).toMatchObject({ end: { reason: 'dropped', lag: 51 } });
    expect(dropped).toEqual([{ connId: 'conn:A', payload: { subscription: expect.stringMatching(/^sub:/), lag: 51, since: expect.any(Number) } }]);
    expect(holds.n).toBe(0);
    // B: paused, then drained — every row arrives, in order, nothing dropped
    const b = mk('conn:B');
    hub.subscribe(b.ctx, grant, { ...p, since: log.head().seq });
    b.st.after.forEach((f) => f());
    for (let i = 0; i < 40; i++) await log.append({ kind: 'config.prefs', principal: 'p:abcdefgh/kernel', payload: { b: i } });
    await sleep(10);
    for (let round = 0; round < 50 && b.st.frames.length < 40; round++) {
      b.st.buffered = 0;
      b.st.drains.splice(0).forEach((f) => f());
      await sleep(5);
    }
    const seqs = b.st.frames.map((f) => (f.row as LogView).seq);
    expect(seqs.length).toBe(40);
    expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    expect(hub.stats().dropped).toBe(1);
    hub.disconnect('conn:B');
    expect(holds.n).toBe(0);
  });

  it('G-SOCK-03: daemon, real cap (10 000): a reader that stops reading is dropped, socket.subscription.dropped is logged with its connId, memory stays bounded', async () => {
    const r = await rig();
    const c = await rawAuthed(r);
    c.send(requestFrame(3, 'log.read', { follow: true, kinds: ['config.prefs'], since: r.d.log.head().seq }));
    const [sub] = await c.next(1);
    const subId = (sub as { result: { subscription: string } }).result.subscription;
    c.conn.pause(); // the slow reader
    let n = 0;
    while (r.d.subscriptions().dropped === 0 && n < 40_000) {
      for (let i = 0; i < 500; i++) await r.d.log.append({ kind: 'config.prefs', principal: K(r), payload: { n: n++ } });
    }
    const st = r.d.subscriptions();
    expect(st.dropped).toBe(1);
    expect(st.active).toBe(0);
    expect(st.maxLag).toBe(SUBSCRIPTION_BACKLOG_CAP + 1);
    expect(st.maxBuffered).toBeLessThanOrEqual(1024 * 1024 + 64 * 1024); // write high-water + one frame
    await sleep(20);
    const rows = [...r.d.log.read({ reader: { class: 'human' }, kinds: ['socket.subscription.dropped'] })] as Array<{ event: EventV1 }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event).toMatchObject({ connId: expect.stringMatching(/^conn:/), payload: { subscription: subId, lag: SUBSCRIPTION_BACKLOG_CAP + 1, since: expect.any(Number) } });
    expect(rows[0]!.event.sig).toBeDefined();
    c.conn.resume();
    let end: Res | undefined;
    for (let i = 0; i < 300 && !end; i++) {
      end = c.frames.find((f) => (f.params as Res | undefined)?.end !== undefined) as Res | undefined;
      if (!end) await sleep(10);
    }
    expect(end).toMatchObject({ method: 'event', params: { subscription: subId, end: { reason: 'dropped', lag: SUBSCRIPTION_BACKLOG_CAP + 1 } } });
    // delivered rows before the drop are contiguous and in order
    const delivered = c.frames.filter((f) => (f.params as Res | undefined)?.row).map((f) => ((f.params as Res).row as LogView).seq);
    for (let i = 1; i < delivered.length; i++) expect(delivered[i]).toBeGreaterThan(delivered[i - 1]!);
  }, 120_000);

  it('subscription caps: at most 8 per connection; since past the head and until are refused', async () => {
    const r = await rig();
    const s = await session(r);
    for (let i = 0; i < 8; i++) ok(await s.conn.call('log.read', { follow: true, since: r.d.log.head().seq }));
    expect(errOf(await s.conn.call('log.read', { follow: true }))).toMatchObject({ c: 'BAD_REQUEST', reason: 'subscription-cap' });
    const s2 = await session(r);
    expect(errOf(await s2.conn.call('log.read', { follow: true, until: 3 }))).toMatchObject({ reason: 'bad-until' });
    expect(errOf(await s2.conn.call('log.read', { follow: true, since: 10_000_000 }))).toMatchObject({ reason: 'since-ahead' });
  });
});

/* ── round 2 (Aegis + reviewer) ───────────────────────────────────────────── */

function fakeCtx(connId: string, hw = 1 << 30) {
  const st = { buffered: 0, frames: [] as Res[], after: [] as Array<() => void> };
  const ctx: ConnectionContext = {
    connId,
    closed: false,
    close: () => undefined,
    authenticated: () => undefined,
    notify: (_m, p) => (st.frames.push(p as Res), true),
    writableLength: () => st.buffered,
    writeHighWater: hw,
    onDrain: () => () => undefined,
    afterReply: (fn) => void st.after.push(fn),
  };
  return { st, ctx };
}

/** A keystore anchor whose writes can be held and then resolved or rejected. */
function gatedKeystore() {
  const g = { hold: false, waiting: [] as Array<{ res: () => void; rej: (e: Error) => void }>, stored: undefined as HeadAnchor | undefined };
  const ks: AnchorStore = {
    name: 'keystore',
    read: () => (g.stored ? { state: 'present', head: g.stored } : { state: 'absent' }),
    write: async (h) => {
      if (g.hold) await new Promise<void>((res, rej) => g.waiting.push({ res, rej }));
      g.stored = h;
    },
  };
  return { g, ks };
}

const KP = 'p:abcdefgh/kernel';
function logHome(): string {
  const t = tempHome('g2-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  return t.home;
}

describe('round 2: no confirmation oracle in limited views (Aegis #1)', () => {
  it('limited rows carry no hash/sig/prev; a dictionary guess of a redacted path cannot be confirmed from the reply', async () => {
    const r = await rig();
    const seqs = await seedSensitive(r);
    const s = await session(r);
    const res = ok(await s.conn.call('log.read', { limit: 1000 }));
    for (const v of res.rows as LogView[]) {
      const obj = (v.view === 'stub' ? v.stub : v.event) as Res;
      for (const k of ['hash', 'sig', 'prev']) expect(Object.hasOwn(obj, k)).toBe(false);
    }
    const auto = (res.rows as LogView[]).find((v) => v.seq === seqs.auto) as { event: Res };
    expect((auto.event.payload as Res).path).toEqual({ redacted: true });
    // Attacker: for each guess, the field digest and the full envelope digest with the guess substituted.
    const real = [...r.d.log.read({ reader: { class: 'human' }, fromSeq: seqs.auto, toSeq: seqs.auto })][0] as { event: EventV1 };
    const replyText = JSON.stringify(res);
    for (const guess of ['MARK-path', '/src/app.ts', 'wrong']) {
      const { hash: _h, sig: _s, ...env } = { ...real.event, payload: { ...(real.event.payload as Res), path: guess } };
      void _h;
      void _s;
      for (const digest of [sha256TaggedFast(canonicalJson(guess)), sha256TaggedFast(canonicalJson(env))]) expect(replyText).not.toContain(digest.slice(7));
    }
    // and nothing in the seeded rows' projections carries any sha256 at all
    const seeded = (res.rows as LogView[]).filter((v) => Object.values(seqs).includes(v.seq));
    // (keyId is the PUBLIC signer key id, sha256 of its PEM — not derived from any payload; removed before the check)
    expect(JSON.stringify(seeded, (k, v) => (k === 'keyId' ? undefined : v))).not.toMatch(/[0-9a-f]{64}/);
    // ref.resolve for a stub: no hash either
    const injId = ([...r.d.log.read({ reader: { class: 'human' }, fromSeq: seqs.inject, toSeq: seqs.inject })][0] as { event: EventV1 }).event.id;
    const rr = ok(await s.conn.call('ref.resolve', { ref: injId }));
    expect(rr).toEqual({ ref: injId, target: { seq: seqs.inject, view: 'stub', stub: { kind: 'session.inject', hsid: HSID, at: expect.any(String) } } });
  });

  it('a scope filter on repo never matches (or reveals) a stubbed row', async () => {
    const r = await rig();
    await r.d.log.append({ kind: 'session.inject', principal: K(r), session: HSID, scope: { org: null, team: null, repo: 'repo:0123456789abcdef' } as never, payload: { origin: 'client', hash: SHA, bytes: 1 } });
    const s = await session(r);
    expect((ok(await s.conn.call('log.read', { kinds: ['session.inject'] })).rows as unknown[]).length).toBe(1);
    expect(ok(await s.conn.call('log.read', { kinds: ['session.inject'], scope: { repo: 'repo:0123456789abcdef' } })).rows).toEqual([]);
    expect((ok(await s.conn.call('log.read', { kinds: ['session.inject'], scope: { hsid: HSID } })).rows as unknown[]).length).toBe(1);
  });
});

describe('round 2: released head — D83 ordering for reads and tail delivery (Aegis #2)', () => {
  it('a critical row whose keystore anchor is pending is invisible (and so is every later row) to log.read, ref lookup and subscriptions until it resolves', async () => {
    const { g, ks } = gatedKeystore();
    const log = openKernelLog({ home: logHome(), kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate(), keystoreAnchor: ks, keystoreTimeoutMs: 60_000 });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { warm: 1 } });
    const hub = new SubscriptionHub({ log });
    cleanups.push(() => hub.close());
    const a = fakeCtx('conn:A');
    hub.subscribe(a.ctx, { reader: { class: 'human' }, projection: 'full' }, { since: log.head().seq, limit: 256, follow: true });
    a.st.after.forEach((f) => f());
    g.hold = true;
    const crit = log.append({ kind: 'config.loaded', principal: KP, payload: { hash: SHA, signed: true } });
    await sleep(10);
    const critSeq = log.head().seq;
    const raw = new DatabaseSync(path.join(log.home, 'kernel.db'), { readOnly: true });
    const critId = (raw.prepare('SELECT id FROM chain WHERE seq = ?').get(critSeq) as { id: string }).id;
    raw.close();
    await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { after: 1 } });
    await sleep(20);
    expect(log.releasedHead()).toBe(critSeq - 1);
    const seen = [...log.read({ reader: { class: 'human' } })].map((v) => v.seq);
    expect(Math.max(...seen)).toBe(critSeq - 1);
    expect(log.getById(critId, { class: 'human' })).toBeUndefined();
    expect(a.st.frames).toEqual([]);
    g.hold = false;
    g.waiting.splice(0).forEach((w) => w.res());
    await crit;
    await sleep(20);
    expect(log.releasedHead()).toBe(critSeq + 1);
    expect(a.st.frames.map((f) => (f.row as LogView).seq)).toEqual([critSeq, critSeq + 1]);
    expect(log.getById(critId, { class: 'human' })).toMatchObject({ view: 'full' });
  });

  it('failed anchoring: the critical row never appears as effective; its daemon.anchor.failed marker does; later rows are released', async () => {
    const { g, ks } = gatedKeystore();
    const log = openKernelLog({ home: logHome(), kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate(), keystoreAnchor: ks, keystoreTimeoutMs: 60_000 });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { warm: 1 } });
    g.hold = true;
    const crit = log.append({ kind: 'config.loaded', principal: KP, payload: { hash: SHA, signed: false } });
    await sleep(10);
    const critSeq = log.head().seq;
    g.hold = false;
    g.waiting.splice(0).forEach((w) => w.rej(new Error('keystore down')));
    await expect(crit).rejects.toMatchObject({ refusal: { data: { reason: 'anchor-failed' } } });
    await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { after: 1 } });
    const views = [...log.read({ reader: { class: 'human' } })] as Array<{ seq: number; event: EventV1 }>;
    expect(views.map((v) => v.seq)).not.toContain(critSeq);
    expect(views.find((v) => v.event.kind === 'daemon.anchor.failed')?.event.payload).toMatchObject({ seq: critSeq });
    expect(Math.max(...views.map((v) => v.seq))).toBe(log.head().seq);
  });
});

describe('round 2: backlog cap at subscribe and lag = head − cursor (reviewer #3)', () => {
  it('subscribe refuses BAD_REQUEST backlog-too-large when head − since > cap; following from a page cursor works', async () => {
    const log = openKernelLog({ home: logHome(), kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate() });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    for (let i = 0; i < 30; i++) await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { i } });
    const hub = new SubscriptionHub({ log, backlogCap: 20 });
    cleanups.push(() => hub.close());
    const a = fakeCtx('conn:A');
    expect(() => hub.subscribe(a.ctx, { reader: { class: 'human' }, projection: 'full' }, { since: 0, limit: 256, follow: true })).toThrow(
      expect.objectContaining({ refusal: expect.objectContaining({ code: 'BAD_REQUEST', data: expect.objectContaining({ reason: 'backlog-too-large', backlog: 30, admit: 10, backlogCap: 20 }) }) }),
    );
    // round 3: at most cap/2 backlog is admitted (15 > 10 refused; 10 admitted)
    expect(() => hub.subscribe(a.ctx, { reader: { class: 'human' }, projection: 'full' }, { since: 15, limit: 256, follow: true })).toThrow(
      expect.objectContaining({ refusal: expect.objectContaining({ data: expect.objectContaining({ reason: 'backlog-too-large', backlog: 15 }) }) }),
    );
    expect(hub.subscribe(a.ctx, { reader: { class: 'human' }, projection: 'full' }, { since: 20, limit: 256, follow: true })).toMatchObject({ since: 20 });
  });
});

describe('round 2: commit-path fan-out is metadata-only (both reviewers #4)', () => {
  it('a commit projects nothing and hashes nothing per subscriber; work per commit is one O(1) check per subscriber', async () => {
    const log = openKernelLog({ home: logHome(), kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate() });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    const hub = new SubscriptionHub({ log, maxTotal: 1000, maxPerConnection: 1000 });
    cleanups.push(() => hub.close());
    const measure = async (n: number): Promise<{ projections: number; wakes: number }> => {
      for (let i = 0; i < n; i++) hub.subscribe(fakeCtx(`conn:${n}-${i}`).ctx, { reader: { class: 'community-client' }, projection: 'community-client' }, { since: log.head().seq, limit: 256, follow: true });
      const p0 = projectionStats.calls;
      const w0 = hub.stats().wakes;
      let during = -1;
      const off = log.onCommit(() => (during = projectionStats.calls - p0)); // registered after the hub's listener
      await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { n } });
      off();
      return { projections: during, wakes: hub.stats().wakes - w0 };
    };
    const one = await measure(1);
    const many = await measure(200);
    expect(one.projections).toBe(0);
    expect(many.projections).toBe(0);
    expect(many.wakes).toBe(201); // one metadata decision per live subscriber (pumps not started: no reads at all)
    expect(hub.stats().delivered).toBe(0);
  });
});

describe('round 3', () => {
  it('limited views carry no idem, refHash or inputHash (Aegis #1); the human projection keeps them', async () => {
    const r = await rig();
    const ref = firstEventId(r);
    const ih = sha256TaggedFast('{"cmd":"rm -rf /"}');
    const idem = sha256TaggedFast('idem-1');
    const refHash = sha256TaggedFast('ref-target');
    const seq = (await r.d.log.append({ kind: 'approval.auto', principal: K(r), idem, ref, refHash, payload: { hsid: HSID, tool: 'Bash', path: 'MARK-p', inputHash: ih, modeRef: 'x' } })).seq;
    const s = await session(r);
    const res = ok(await s.conn.call('log.read', { kinds: ['approval.auto'] }));
    const v = (res.rows as Array<{ seq: number; event: Res }>).find((x) => x.seq === seq)!;
    for (const k of ['idem', 'refHash', 'hash', 'sig', 'prev']) expect(Object.hasOwn(v.event, k)).toBe(false);
    expect(v.event.ref).toBe(ref); // the ref itself is a pointer, not a digest of content
    expect(v.event.payload).toMatchObject({ inputHash: { redacted: true }, path: { redacted: true }, tool: 'Bash' });
    const text = JSON.stringify(res);
    for (const d of [ih, idem, refHash]) expect(text).not.toContain(d.slice(7));
    const full = [...r.d.log.read({ reader: { class: 'human' }, fromSeq: seq, toSeq: seq })][0] as { event: EventV1 };
    expect(full.event).toMatchObject({ idem, refHash, payload: { inputHash: ih } });
  });

  it('lag counts only up to the released head: a held critical row does not drop subscribers while bulk rows queue behind it (reviewer)', async () => {
    const { g, ks } = gatedKeystore();
    const log = openKernelLog({ home: logHome(), kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate(), keystoreAnchor: ks, keystoreTimeoutMs: 60_000 });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { warm: 1 } });
    const hub = new SubscriptionHub({ log, backlogCap: 20 });
    cleanups.push(() => hub.close());
    const a = fakeCtx('conn:A');
    hub.subscribe(a.ctx, { reader: { class: 'human' }, projection: 'full' }, { since: log.head().seq, limit: 256, follow: true });
    a.st.after.forEach((f) => f());
    g.hold = true;
    const crit = log.append({ kind: 'config.loaded', principal: KP, payload: { hash: SHA, signed: true } });
    await sleep(10);
    for (let i = 0; i < 30; i++) await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { i } });
    expect(hub.stats().dropped).toBe(0);
    g.hold = false;
    g.waiting.splice(0).forEach((w) => w.res());
    await crit;
    for (let i = 0; i < 50 && a.st.frames.length < 31; i++) await sleep(10);
    expect(a.st.frames).toHaveLength(31);
    expect(hub.stats().dropped).toBe(0);
  });
});

describe('round 2: nits', () => {
  it('getById: a tampered row is row-integrity only for a reader who could see it; NOT_FOUND (undefined) otherwise', async () => {
    const home = logHome();
    const log = openKernelLog({ home, kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate() });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    const e = (await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { x: 'a' } })).event;
    const db = new DatabaseSync(path.join(home, 'kernel.db'));
    db.exec('DROP TRIGGER chain_no_update');
    db.prepare(`UPDATE chain SET envelope = replace(envelope, '"x":"a"', '"x":"b"') WHERE seq = ?`).run(e.seq);
    db.close();
    expect(log.getById(e.id, { class: 'community-client' })).toBe('withheld');
    expect(log.getById(e.id, { class: 'mod', name: 'w', grantedKinds: [] })).toBeUndefined();
  });

  it('prev linkage: a row rewritten with a recomputed hash breaks the next row\'s prev and that row is withheld (residual: the rewritten row itself)', async () => {
    const home = logHome();
    const log = openKernelLog({ home, kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate() });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    const a = (await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { x: 'a' } })).event;
    const b = (await log.append({ kind: 'socket.frame.dropped', principal: KP, payload: { x: 'c' } })).event;
    const db = new DatabaseSync(path.join(home, 'kernel.db'));
    db.exec('DROP TRIGGER chain_no_update');
    const env = (db.prepare('SELECT envelope FROM chain WHERE seq = ?').get(a.seq) as { envelope: string }).envelope.replace('"x":"a"', '"x":"z"');
    db.prepare('UPDATE chain SET envelope = ?, hash = ? WHERE seq = ?').run(env, sha256TaggedFast(env), a.seq);
    db.close();
    let withheld = 0;
    const seen: number[] = [];
    log.readPage({ reader: { class: 'human' }, afterSeq: 0, maxScan: 100, visit: (v) => (seen.push(v.seq), true) });
    withheld = log.readPage({ reader: { class: 'human' }, afterSeq: 0, maxScan: 100, visit: () => true }).withheld;
    expect(seen).toContain(a.seq);
    expect(seen).not.toContain(b.seq);
    expect(withheld).toBe(1);
  });

  it('follow:true on a JSON-RPC notification (no id) opens no subscription', async () => {
    const r = await rigOnce();
    const c = await rawAuthed(r);
    c.send({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: 'log.read', params: { follow: true, since: r.d.log.head().seq } });
    await sleep(50);
    expect(r.d.subscriptions().active).toBe(0);
    c.send(requestFrame(9, 'status', {}));
    const [st] = await c.next(1);
    expect((st as { result: Res }).result.subscriptions).toMatchObject({ n: 0 });
  });

  it('writeHighWater is never below the socket writableHighWaterMark (the pump cannot stall waiting for a drain that never fires)', async () => {
    const t = tempHome('gw-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    let hw = -1;
    const srv = await listenSocket({ socketPath: path.join(t.home, 's.sock'), writeHighWater: 1, handle: (_f, ctx) => ((hw = ctx.writeHighWater), {}) });
    cleanups.push(() => srv.close());
    const c = await rawConnect(srv.socketPath);
    cleanups.push(() => c.close());
    c.send(requestFrame(1, 'x', {}));
    await c.next(1);
    expect(hw).toBeGreaterThanOrEqual(16 * 1024);
  });
});

describe('pre-existing (round 2): dispatch never re-creates state for a closed connection', () => {
  it('a request handled after its connection closed (queued behind the close) creates no state: zombies cannot fill maxPreAuth', async () => {
    const t = tempHome('gz-');
    cleanups.push(t.cleanup);
    const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
    const kernel = SoftwareEd25519Signer.generate('kernel');
    registerKernelKey(t.home, root, kernel.publicKeyPem);
    const dispatcher = createKernelDispatcher({
      authenticator: new SocketAuthenticator({ home: t.home, endpointPath: 'x.sock', kernelSigner: kernel, trust: root }),
      maxPreAuth: 2,
      status: { daemon: () => ({}), log: () => ({}), kernelKey: () => ({ keyId: kernel.keyId, custody: 'partial', source: 'test' }), root: () => ({ state: 'dev-test', rootKeyId: root.rootKeyId }) },
      log: async () => undefined,
    });
    const mkCtx = (connId: string) => {
      const c = { connId, closed: false, closedByServer: false } as ConnectionContext & { closed: boolean; closedByServer: boolean };
      Object.assign(c, { close: () => void (c.closedByServer = true), authenticated: () => undefined, notify: () => false, writableLength: () => 0, writeHighWater: 1, onDrain: () => () => undefined, afterReply: () => undefined });
      return c;
    };
    const hello = requestFrame(1, 'hello', { clientApis: ['gnomon-rpc:v1'], features: [], client: CLIENT });
    for (let i = 0; i < 5; i++) {
      const ctx = mkCtx(`conn:Z${i}`);
      dispatcher.onConnect(ctx);
      ctx.closed = true; // the socket closed while this hello was still queued
      dispatcher.onDisconnect(ctx);
      await expect(dispatcher.handle(hello, ctx)).rejects.toMatchObject({ refusal: { data: { reason: 'gone' } } });
    }
    const fresh = mkCtx('conn:FRESH');
    dispatcher.onConnect(fresh);
    expect(fresh.closedByServer).toBe(false); // not refused by a cap full of zombies
    dispatcher.onDisconnect(fresh);
  });
});

let rigCache: Rig | undefined;
async function rigOnce(): Promise<Rig> {
  rigCache = await rig();
  return rigCache;
}

/**
 * T-2026-10-19-009 item 6 (Orca audit Adopt 6; spec §11.2): high/low
 * watermarks on the transcript stream (log.read{follow}, the stream the GUI
 * WebSocket carries) and a distinct `delivery-unknown` error when a
 * connection drops after a request was sent and before its answer.
 * Every platform: a real kernel log + the subscription hub over a fake
 * connection, and the client call layers over a fake socket.
 */
import { EventEmitter } from 'node:events';
import { mkdirSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { SoftwareEd25519Signer } from '../src/kernel/log/index.js';
import { openKernelLog } from '../src/kernel/testing.js';
import { DEFAULT_WRITE_LOW_WATER, DEFAULT_WRITE_HIGH_WATER, RpcConnection, SubscriptionHub, type ConnectionContext } from '../src/kernel/socket/index.js';
import { WS_WRITE_HIGH_WATER, WS_WRITE_LOW_WATER } from '../src/kernel/web/protocol.js';
import { GnomonClient } from '../src/clients/ts/client.js';
import { tempHome } from './daemon-helpers.js';

type Res = Record<string, unknown>;
const KP = 'p:abcdefgh/kernel';
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('§11.2: high/low watermarks on the transcript stream', () => {
  it('the low mark sits below the high mark everywhere it is configured', () => {
    expect(DEFAULT_WRITE_LOW_WATER).toBeLessThan(DEFAULT_WRITE_HIGH_WATER);
    expect(WS_WRITE_LOW_WATER).toBeLessThan(WS_WRITE_HIGH_WATER);
  });

  it('FALSIFIER: a pump stopped at the high mark does not resume on a drain above the low mark (no flapping), and does below it', async () => {
    const t = tempHome('bp-');
    cleanups.push(t.cleanup);
    mkdirSync(t.home, { recursive: true, mode: 0o700 });
    const log = openKernelLog({ home: t.home, kernelPrincipal: KP, signer: SoftwareEd25519Signer.generate() });
    cleanups.push(async () => void (await log.close().catch(() => undefined)));
    const hub = new SubscriptionHub({ log });
    cleanups.push(() => hub.close());
    const st = { buffered: 0, frames: [] as Res[], drains: [] as Array<() => void>, after: [] as Array<() => void> };
    const ctx: ConnectionContext = {
      connId: 'conn:A',
      closed: false,
      close: () => undefined,
      authenticated: () => undefined,
      notify: (_m, p) => (st.frames.push(p as Res), (st.buffered += 50), true),
      writableLength: () => st.buffered,
      writeHighWater: 100,
      writeLowWater: 20,
      onDrain: (fn) => (st.drains.push(fn), () => void (st.drains = st.drains.filter((f) => f !== fn))),
      afterReply: (fn) => void st.after.push(fn),
    };
    const since = log.head().seq;
    hub.subscribe(ctx, { reader: { class: 'human' }, projection: 'full' }, { since, limit: 256, follow: true, kinds: (k: string) => k === 'config.prefs' });
    st.after.forEach((f) => f());
    for (let i = 0; i < 12; i++) await log.append({ kind: 'config.prefs', principal: KP, payload: { i } });
    for (let i = 0; i < 5; i++) await tick();
    const atHigh = st.frames.length;
    expect(atHigh).toBeGreaterThan(0);
    expect(atHigh).toBeLessThan(12);
    expect(st.drains.length).toBe(1); // stopped, waiting for a drain
    // drained to 60: below the high mark but above the low mark — must keep waiting
    st.buffered = 60;
    st.drains.shift()!();
    for (let i = 0; i < 5; i++) await tick();
    expect(st.frames.length).toBe(atHigh);
    expect(st.drains.length).toBe(1);
    // drained to 10 (<= low): resumes
    st.buffered = 10;
    st.drains.shift()!();
    for (let i = 0; i < 5; i++) await tick();
    expect(st.frames.length).toBeGreaterThan(atHigh);
  });
});

/** A socket stand-in: records writes; the test answers or drops. */
class FakeSock extends EventEmitter {
  writes: string[] = [];
  destroyed = false;
  writable = true;
  writableEnded = false;
  write(b: Buffer | string): boolean {
    this.writes.push(String(b));
    return true;
  }
  destroy(): void {
    this.destroyed = true;
    this.writable = false;
    this.emit('close');
  }
}

function reasonOf(f: Res): unknown {
  return ((f.error as Res | undefined)?.data as { data?: Res } | undefined)?.data?.reason;
}

describe('delivery-unknown: a drop after send is neither success nor a plain failure', () => {
  it('FALSIFIER: the kernel RPC client reports delivery-unknown for a written request whose reply never came; connection-closed only for one never sent', async () => {
    const sock = new FakeSock();
    const conn = new (RpcConnection as unknown as new (s: unknown) => RpcConnection)(sock);
    // control: a reply that arrives is the reply
    const answered = conn.call('status');
    const id0 = JSON.parse(sock.writes[0]!).id;
    sock.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: id0, result: { ok: true } })}\n`));
    expect(await answered).toMatchObject({ result: { ok: true } });
    // sent, then the connection drops before the answer
    const inFlight = conn.call('approve', { cardId: 'card:x', decision: 'allow' });
    expect(sock.writes.length).toBe(2);
    sock.emit('close');
    const f = (await inFlight) as unknown as Res;
    expect(reasonOf(f)).toBe('delivery-unknown');
    expect(f).not.toHaveProperty('result');
    // never sent: certainly not delivered
    expect(reasonOf((await conn.call('status')) as unknown as Res)).toBe('connection-closed');
    expect(sock.writes.length).toBe(2);
  });

  it('FALSIFIER: a call on a socket that can no longer write is connection-closed and writes nothing, even before the close event', async () => {
    const sock = new FakeSock();
    const conn = new (RpcConnection as unknown as new (s: unknown) => RpcConnection)(sock);
    sock.writable = false; // ended under us; 'close' not seen yet
    expect(reasonOf((await conn.call('status')) as unknown as Res)).toBe('connection-closed');
    expect(sock.writes.length).toBe(0);
  });

  it('FALSIFIER: the TS GnomonClient rejects delivery-unknown for a written request whose reply never came; connection-closed only for one never sent', async () => {
    const sock = new FakeSock();
    const client = new (GnomonClient as unknown as new (s: unknown, log: undefined, timeoutMs: number) => GnomonClient)(sock, undefined, 5_000);
    // control: a reply that arrives is the reply
    const answered = client.callRaw('status');
    const id0 = JSON.parse(sock.writes[0]!).id;
    sock.emit('data', Buffer.from(`${JSON.stringify({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: id0, result: { ok: true } })}\n`));
    expect(await answered).toEqual({ ok: true });
    // sent, then the connection drops before the answer
    const inFlight = client.callRaw('approve', { cardId: 'card:x', decision: 'allow' });
    expect(sock.writes.length).toBe(2);
    sock.emit('close');
    await expect(inFlight).rejects.toMatchObject({ refusal: { code: 'ENGINE', data: { reason: 'delivery-unknown' } } });
    // never sent: certainly not delivered
    await expect(client.callRaw('status')).rejects.toMatchObject({ refusal: { data: { reason: 'connection-closed' } } });
    expect(sock.writes.length).toBe(2);
    // and a socket that stopped being writable before 'close' is also never-sent
    const sock2 = new FakeSock();
    const c2 = new (GnomonClient as unknown as new (s: unknown, log: undefined, timeoutMs: number) => GnomonClient)(sock2, undefined, 5_000);
    sock2.writableEnded = true;
    await expect(c2.callRaw('status')).rejects.toMatchObject({ refusal: { data: { reason: 'connection-closed' } } });
    expect(sock2.writes.length).toBe(0);
  });
});

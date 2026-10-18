/**
 * The `gnomon-web` child against a FAKE kernel channel (spec §11.2 rules 1b
 * and 6; Aegis C6): per-connection backpressure (`pressure` → 1008 past
 * 8 MiB unsent; `drain` when the reader resumes, then the stream continues)
 * and the child's own 503 when the kernel never answers, carrying the rule-6
 * default headers. Drives dist/transport/gnomon-web.js directly over stdio;
 * the fake kernel listens on 127.0.0.1 and hands each accepted socket over
 * the IPC channel, as endpoint.ts does (the child listens on nothing, §15.5).
 * Platform-independent.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NdjsonDecoder } from '../src/kernel/socket/framing.js';
import { childDefaultHeaders, materializePlaceholderBundle } from '../src/kernel/web/index.js';
import type { ChildRecord, KernelRecord } from '../src/kernel/web/protocol.js';
import { PKG_ROOT } from './helpers.js';
import { tempHome } from './daemon-helpers.js';
import { GOOD, rawHttp, wsConnect } from './web-helpers.js';

const CHILD = path.join(PKG_ROOT, 'dist', 'transport', 'gnomon-web.js');
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function fakeKernel(extra: { answerTimeoutMs?: number; headersTimeoutMs?: number; requestTimeoutMs?: number } = {}) {
  const t = tempHome('gc-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  const bundleDir = materializePlaceholderBundle(t.home);
  const child: ChildProcess = spawn(process.execPath, [CHILD], { stdio: ['pipe', 'pipe', 'inherit', 'ipc'] });
  cleanups.push(() => child.kill('SIGKILL'));
  const listener = net.createServer({ pauseOnConnect: true }, (s) => child.send('conn', s));
  await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
  cleanups.push(() => listener.close());
  child.stdin!.on('error', () => undefined); // the killed child's pipe
  const recs: ChildRecord[] = [];
  const dec = new NdjsonDecoder(16 * 1024 * 1024);
  child.stdout!.on('data', (c: Buffer) => {
    for (const i of dec.push(c)) if (i.kind === 'frame') recs.push(i.value as unknown as ChildRecord);
  });
  const send = (r: KernelRecord) => child.stdin!.write(`${JSON.stringify(r)}\n`);
  send({
    t: 'config', bundleDir, pingMs: 60_000, missedPongs: 2, maxFrameBytes: 4 * 1024 * 1024, preAuthMaxFrameBytes: 16 * 1024,
    maxBodyBytes: 64 * 1024, maxSocketBuffer: 8 * 1024 * 1024, writeHighWater: 1024 * 1024, defaultHeaders: childDefaultHeaders(), ...extra,
  });
  const wait = async <T extends ChildRecord['t']>(t: T, ms = 10_000): Promise<Extract<ChildRecord, { t: T }>> => {
    const end = Date.now() + ms;
    for (;;) {
      const i = recs.findIndex((r) => r.t === t);
      if (i !== -1) return recs.splice(i, 1)[0] as Extract<ChildRecord, { t: T }>;
      if (Date.now() > end) throw new Error(`no ${t} record`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  await wait('ready');
  return { port: (listener.address() as net.AddressInfo).port, send, wait, recs };
}

const MiB = Buffer.alloc(1024 * 1024, 0x61).toString('base64');

describe('backpressure per connection (Aegis C6)', () => {
  it('a reader that stops reading: `pressure`, then 1008 backpressure past 8 MiB unsent', async () => {
    const k = await fakeKernel();
    const wsP = wsConnect(k.port);
    const up = await k.wait('upgrade');
    k.send({ t: 'accept', rid: up.rid });
    const ws = await wsP;
    cleanups.push(() => ws.end());
    ws.socket.pause(); // the client stops reading
    for (let i = 0; i < 64; i++) {
      k.send({ t: 'send', rid: up.rid, data: MiB });
      if (k.recs.some((r) => r.t === 'closed')) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const p = await k.wait('pressure');
    expect(p.rid).toBe(up.rid);
    expect(p.bytes).toBeGreaterThan(1024 * 1024);
    const c = await k.wait('closed');
    expect(c).toMatchObject({ rid: up.rid, code: 1008, why: 'backpressure' });
  });

  it('a reader that resumes: `drain`, and the stream continues', async () => {
    const k = await fakeKernel();
    const wsP = wsConnect(k.port);
    const up = await k.wait('upgrade');
    k.send({ t: 'accept', rid: up.rid });
    const ws = await wsP;
    cleanups.push(() => ws.end());
    ws.socket.pause();
    for (let i = 0; i < 6 && !k.recs.some((r) => r.t === 'pressure'); i++) {
      k.send({ t: 'send', rid: up.rid, data: MiB });
      await new Promise((r) => setTimeout(r, 30));
    }
    await k.wait('pressure');
    ws.socket.resume();
    expect((await k.wait('drain')).rid).toBe(up.rid);
    k.send({ t: 'send', rid: up.rid, data: Buffer.from('{"after":"drain"}').toString('base64') });
    const deadline = Date.now() + 10_000;
    while (!ws.frames.some((f) => f.payload.toString() === '{"after":"drain"}') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(ws.frames.some((f) => f.payload.toString() === '{"after":"drain"}')).toBe(true);
    expect(k.recs.some((r) => r.t === 'closed')).toBe(false);
  });
});

describe("the child's own 503 carries the rule-6 default headers", () => {
  it('a kernel that never answers ⇒ 503 with CSP default-src none, COOP, CORP, nosniff, no-referrer, no-store; no ACAO', async () => {
    const k = await fakeKernel({ answerTimeoutMs: 200 });
    const r = await rawHttp(k.port, 'GET', '/', GOOD(k.port));
    expect(r.status).toBe(503);
    expect(r.headers).toMatchObject({
      'content-security-policy': childDefaultHeaders()['content-security-policy'],
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
    expect(Object.keys(r.headers).some((h) => h.startsWith('access-control') || h === 'set-cookie')).toBe(false);
    // an upgrade the kernel never answers: the same headers on the raw 503
    const ws = await wsConnect(k.port);
    expect(ws.status).toBe(503);
    expect(ws.headers['content-security-policy']).toBe(childDefaultHeaders()['content-security-policy']);
  });
});

/*
 * Round 2 (blocking): an http.Server that never listen()s does not run Node's headersTimeout/requestTimeout checker
 * (it starts on 'listening'), so the child bounds every handed socket itself.
 */
describe('slowloris: a handed socket is bounded per socket (the child never listens)', () => {
  const closedWithin = (sock: net.Socket): Promise<number> => {
    const t0 = Date.now();
    return new Promise((r) => sock.once('close', () => r(Date.now() - t0)));
  };
  const open = (port: number): Promise<net.Socket> =>
    new Promise((r, j) => {
      const c = net.connect({ host: '127.0.0.1', port });
      c.once('connect', () => r(c));
      c.once('error', j);
    });

  it('a partial request line is closed within about headersTimeout', async () => {
    const k = await fakeKernel({ headersTimeoutMs: 500 });
    const c = await open(k.port);
    cleanups.push(() => c.destroy());
    c.on('error', () => undefined);
    const closed = closedWithin(c);
    c.write('GET / HTTP/1.1\r\n');
    const ms = await closed;
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(ms).toBeLessThan(4000);
    expect(k.recs.some((r) => r.t === 'http')).toBe(false); // never forwarded
  });

  it('trickled header bytes do not extend the deadline', async () => {
    const k = await fakeKernel({ headersTimeoutMs: 500 });
    const c = await open(k.port);
    cleanups.push(() => c.destroy());
    c.on('error', () => undefined);
    const closed = closedWithin(c);
    c.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n');
    const drip = setInterval(() => c.writable && c.write('X-A: b\r\n'), 100);
    const ms = await closed;
    clearInterval(drip);
    expect(ms).toBeLessThan(4000);
  });

  it('keep-alive: after a served request, a partial next request is closed too; a slow body is bounded by requestTimeout', async () => {
    const k = await fakeKernel({ headersTimeoutMs: 500, requestTimeoutMs: 700 });
    const c = await open(k.port);
    cleanups.push(() => c.destroy());
    c.on('error', () => undefined);
    let got = '';
    c.on('data', (d: Buffer) => (got += d.toString('latin1')));
    c.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${k.port}\r\n\r\n`);
    const h = await k.wait('http');
    k.send({ t: 'respond', rid: h.rid, status: 204, headers: {} });
    const end = Date.now() + 5000;
    while (!got.includes(' 204 ') && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    expect(got).toContain(' 204 ');
    const closed = closedWithin(c);
    c.write('GET / HT');
    expect(await closed).toBeLessThan(4000);
    // a body that never completes after its headers
    const d = await open(k.port);
    cleanups.push(() => d.destroy());
    d.on('error', () => undefined);
    const dClosed = closedWithin(d);
    d.write(`POST /diag HTTP/1.1\r\nHost: 127.0.0.1:${k.port}\r\nContent-Length: 100\r\n\r\nabc`);
    const ms = await dClosed;
    expect(ms).toBeGreaterThanOrEqual(600);
    expect(ms).toBeLessThan(4000);
  });
});

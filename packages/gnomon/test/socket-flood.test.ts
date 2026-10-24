// @gnomon-platform: darwin, linux
/**
 * #socket memory bounds (Aegis M1): falsifiers for a peer that floods or never
 * reads. (1) maxInFlight holds INSIDE one inbound chunk: hundreds of tiny
 * frames in a single write never queue more than the cap, and every one is
 * still answered, in order (held, not refused). (2) A connection whose unsent
 * bytes pass maxWriteBuffer is destroyed. (3) Connections past maxConnections
 * are dropped.
 */
import { mkdirSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listenSocket, type SocketServerHandle } from '../src/kernel/socket/server.js';
import { encodeFrame, requestFrame } from '../src/kernel/socket/index.js';

const frame = (id: number): Buffer => encodeFrame(requestFrame(id, 'x'));
import { tempHome } from './daemon-helpers.js';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function sockPath(): string {
  const t = tempHome('sf-');
  cleanups.push(t.cleanup);
  mkdirSync(t.home, { recursive: true, mode: 0o700 });
  return path.join(t.home, 'g.sock');
}

async function listen(opts: Omit<Parameters<typeof listenSocket>[0], 'socketPath'>): Promise<SocketServerHandle> {
  const srv = await listenSocket({ socketPath: sockPath(), ...opts });
  cleanups.push(() => srv.close());
  return srv;
}

function connect(p: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection(p, () => resolve(s));
    s.once('error', reject);
    cleanups.push(() => s.destroy());
  });
}

const closed = (s: net.Socket): Promise<void> => new Promise((r) => (s.destroyed ? r() : s.once('close', () => r())));

describe('#socket flood bounds (Aegis M1)', () => {
  it('maxInFlight holds inside one chunk: 300 frames in one write never queue past the cap, and all are answered in order', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const srv = await listen({ maxInFlight: 4, handle: async (f) => (await gate, f.id) });
    const c = await connect(srv.socketPath);
    const frames = Array.from({ length: 300 }, (_, i) => frame(i).toString('utf8')).join('');
    expect(Buffer.byteLength(frames)).toBeLessThan(64 * 1024); // one chunk
    let buf = '';
    const ids: unknown[] = [];
    const all = new Promise<void>((r) =>
      c.on('data', (d) => {
        buf += d.toString('utf8');
        const lines = buf.split('\n');
        buf = lines.pop()!;
        for (const l of lines) ids.push(JSON.parse(l).result);
        if (ids.length === 300) r();
      }),
    );
    c.write(frames);
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.stats().maxQueued).toBeLessThanOrEqual(4); // was ~300 before: the cap was per chunk
    release();
    await all;
    expect(ids).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect(srv.stats().maxQueued).toBeLessThanOrEqual(4);
  });

  it('a peer that never reads is destroyed once its unsent bytes pass maxWriteBuffer', async () => {
    const big = 'z'.repeat(256 * 1024);
    const srv = await listen({ maxWriteBuffer: 1024 * 1024, handle: () => big });
    const c = await connect(srv.socketPath);
    c.pause(); // never reads
    for (let i = 0; i < 40; i++) c.write(frame(i));
    // the paused client never reads its EOF, so watch the server side
    for (let i = 0; i < 200 && srv.connections() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(srv.stats().overflows).toBeGreaterThanOrEqual(1);
    expect(srv.connections()).toBe(0);
  });

  it('connections past maxConnections are dropped; the admitted ones keep serving', async () => {
    const srv = await listen({ maxConnections: 2, handle: () => 'ok' });
    const a = await connect(srv.socketPath);
    const b = await connect(srv.socketPath);
    await new Promise((r) => setTimeout(r, 50));
    const extra = await connect(srv.socketPath).catch(() => null);
    if (extra) await closed(extra);
    expect(srv.connections()).toBe(2);
    const reply = new Promise<string>((r) => a.once('data', (d) => r(d.toString('utf8'))));
    a.write(frame(1));
    expect(JSON.parse(await reply)).toMatchObject({ id: 1, result: 'ok' });
    b.destroy();
  });

  it('writeLowWater is never below the socket writableHighWaterMark (a re-wait on drain is always owed a drain)', async () => {
    let marks: [number, number | undefined] = [0, 0];
    const srv = await listen({ writeHighWater: 1, writeLowWater: 0, handle: (_f, ctx) => ((marks = [ctx.writeHighWater, ctx.writeLowWater]), 'ok') });
    const c = await connect(srv.socketPath);
    const reply = new Promise<void>((r) => c.once('data', () => r()));
    c.write(frame(1));
    await reply;
    expect(marks[0]).toBeGreaterThan(1); // raised to the socket's writableHighWaterMark
    expect(marks[1]).toBe(marks[0]); // low raised with it (and still ≤ high)
  });
});

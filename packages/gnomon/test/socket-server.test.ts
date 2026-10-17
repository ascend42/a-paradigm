// @gnomon-platform: darwin, linux
/**
 * #socket over a live unix socket (spec §4.9): the placeholder `hello` answers
 * a refusal-shaped ENGINE error, unknown verbs UNKNOWN_VERB, frames without the
 * rpc tag BAD_REQUEST; malformed and oversize lines are refused and the
 * connection keeps serving; replies on one connection come back in order.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/kernel/lifecycle/index.js';
import { requestFrame, rpcCall } from '../src/kernel/socket/index.js';
import { rawConnect, tempHome } from './daemon-helpers.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function daemon(maxFrameBytes?: number): Promise<DaemonHandle> {
  const t = tempHome();
  cleanups.push(t.cleanup);
  const d = await startDaemon({ home: t.home, idleMs: 60_000, ...(maxFrameBytes ? { maxFrameBytes } : {}) });
  cleanups.push(() => d.shutdown('signal'));
  return d;
}

describe('#socket gnomon-rpc:v1 placeholder surface', () => {
  it('hello answers a structured not-implemented refusal', async () => {
    const d = await daemon();
    const resp = await rpcCall(d.pidfile.socketPath, 'hello', { clientApis: ['gnomon-rpc:v1'] });
    expect(resp).toEqual({
      jsonrpc: '2.0',
      rpc: 'gnomon-rpc:v1',
      id: 1,
      error: {
        code: -32000,
        message: expect.any(String),
        data: { code: 'ENGINE', reason: 'not-implemented', message: expect.any(String), detail: { verb: 'hello', milestone: 'M1.4' } },
      },
    });
  });

  it('unknown verbs are UNKNOWN_VERB; daemon.status answers', async () => {
    const d = await daemon();
    const unk = await rpcCall(d.pidfile.socketPath, 'session.open');
    expect(unk).toMatchObject({ error: { code: -32601, data: { reason: 'unknown-verb' } } });
    const st = await rpcCall(d.pidfile.socketPath, 'daemon.status');
    expect(st).toMatchObject({ result: { pid: process.pid, socketPath: d.pidfile.socketPath, connections: 1 } });
  });

  it('refuses malformed, untagged and oversize frames and keeps the connection serving, in order', async () => {
    const d = await daemon(256);
    const c = await rawConnect(d.pidfile.socketPath);
    cleanups.push(c.close);
    c.send('{not json\n');
    c.send(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'hello' })}\n`);
    c.send(`{"pad":"${'z'.repeat(300)}"}\n`);
    c.send(Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
    c.send(requestFrame('last', 'daemon.status'));
    const got = await c.next(5);
    expect(got.map((f) => [f.id, (f.error as { code?: number; data?: { reason?: string } } | undefined)?.data?.reason ?? 'ok'])).toEqual([
      [null, 'malformed-json'],
      [9, 'rpc-tag'],
      [null, 'frame-too-large'],
      [null, 'malformed-utf8'],
      ['last', 'ok'],
    ]);
    expect(got[2]!.error).toMatchObject({ code: -32600 });
  });

  it('notifications (no id) get no reply', async () => {
    const d = await daemon();
    const c = await rawConnect(d.pidfile.socketPath);
    cleanups.push(c.close);
    c.send({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: 'hello' });
    c.send(requestFrame(2, 'daemon.status'));
    const got = await c.next(1);
    expect(got[0]!.id).toBe(2);
    expect(c.frames).toEqual([]);
  });
});

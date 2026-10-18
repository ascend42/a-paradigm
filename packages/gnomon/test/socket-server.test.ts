// @gnomon-platform: darwin, linux
/**
 * #socket over a live unix socket (spec §4.9): errors carry refusal:v1, unknown
 * verbs are UNKNOWN_VERB, known verbs before auth are AUTH and close (G-SOCK-01),
 * frames without the rpc tag BAD_REQUEST; malformed and oversize lines are
 * refused and the connection keeps serving; replies on one connection come
 * back in order. Hello/auth/status: test/socket-auth.test.ts (M1.4).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startDaemon, type DaemonHandle } from '../src/kernel/lifecycle/index.js';
import { requestFrame, rpcCall } from '../src/kernel/socket/index.js';
import { isRefusalV1 } from '@a-company/gnomon-contracts';
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

describe('#socket gnomon-rpc:v1 surface', () => {
  it('a malformed hello is BAD_REQUEST carrying refusal:v1', async () => {
    const d = await daemon();
    const resp = await rpcCall(d.pidfile.socketPath, 'hello', { clientApis: ['gnomon-rpc:v1'] });
    expect(resp).toMatchObject({
      jsonrpc: '2.0',
      rpc: 'gnomon-rpc:v1',
      id: 1,
      error: { code: -32600, message: expect.any(String), data: { schemaVersion: 'refusal:v1', code: 'BAD_REQUEST', data: { reason: 'hello-params' } } },
    });
    expect(isRefusalV1((resp as { error: { data: unknown } }).error.data, { mode: 'tolerant' })).toBe(true);
  });

  it('unknown names are UNKNOWN_VERB; known verbs before auth are AUTH; the PR-5 daemon.status placeholder is gone', async () => {
    const d = await daemon();
    const unk = await rpcCall(d.pidfile.socketPath, 'daemon.status');
    expect(unk).toMatchObject({ error: { code: -32601, data: { data: { reason: 'unknown-verb' } } } });
    const st = await rpcCall(d.pidfile.socketPath, 'session.open');
    expect(st).toMatchObject({ error: { code: -32001, data: { code: 'AUTH', data: { reason: 'unauthenticated' } } } });
  });

  it('refuses malformed, untagged and oversize frames and keeps the connection serving, in order', async () => {
    const d = await daemon(256);
    const c = await rawConnect(d.pidfile.socketPath);
    cleanups.push(c.close);
    c.send('{not json\n');
    c.send(`${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'hello' })}\n`);
    c.send(`{"pad":"${'z'.repeat(300)}"}\n`);
    c.send(Buffer.from([0x7b, 0xff, 0x7d, 0x0a]));
    c.send(requestFrame('last', 'no.such')); // unknown name: refused, connection kept (a known verb would close, G-SOCK-01)
    const got = await c.next(5);
    expect(got.map((f) => [f.id, (f.error as { data?: { data?: { reason?: string } } } | undefined)?.data?.data?.reason ?? 'ok'])).toEqual([
      [null, 'malformed-json'],
      [9, 'rpc-tag'],
      [null, 'frame-too-large'],
      [null, 'malformed-utf8'],
      ['last', 'unknown-verb'],
    ]);
    expect(got[2]!.error).toMatchObject({ code: -32600 });
  });

  it('notifications (no id) get no reply', async () => {
    const d = await daemon();
    const c = await rawConnect(d.pidfile.socketPath);
    cleanups.push(c.close);
    // an unknown name keeps the connection (a known verb before auth would close it, G-SOCK-01)
    c.send({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', method: 'no.such' });
    c.send(requestFrame(2, 'no.such'));
    const got = await c.next(1);
    expect(got[0]!.id).toBe(2);
    expect(c.frames).toEqual([]);
  });
});

/**
 * #socket (spec §4.9) — a minimal one-shot `gnomon-rpc:v1` client for the CLI
 * (`gnomon daemon status|stop`) and tests. The published TS client is M1.12.
 */
import * as net from 'node:net';
import { encodeFrame, NdjsonDecoder } from './framing.js';
import { requestFrame, type RpcResponseFrame } from './rpc.js';

export interface CallOptions {
  timeoutMs?: number;
}

/** Send one request and resolve with its response frame. Rejects on connect failure or timeout. */
export function rpcCall(socketPath: string, method: string, params?: unknown, opts: CallOptions = {}): Promise<RpcResponseFrame> {
  const id = 1;
  return new Promise((resolve, reject) => {
    const decoder = new NdjsonDecoder();
    const conn = net.connect(socketPath);
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(Object.assign(new Error(`gnomon-rpc: ${method} timed out`), { code: 'ETIMEDOUT' }))),
      opts.timeoutMs ?? 5000,
    );
    conn.on('connect', () => conn.write(encodeFrame(requestFrame(id, method, params))));
    conn.on('data', (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        if (item.kind === 'frame' && item.value.id === id) finish(() => resolve(item.value as unknown as RpcResponseFrame));
      }
    });
    conn.on('error', (err) => finish(() => reject(err)));
    conn.on('close', () => finish(() => reject(Object.assign(new Error('gnomon-rpc: connection closed'), { code: 'ECONNRESET' }))));
  });
}

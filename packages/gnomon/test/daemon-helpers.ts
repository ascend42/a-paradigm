/** Shared helpers for the $daemon-lifecycle / #socket tests (PR-5). */
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import path from 'node:path';
import { encodeFrame, NdjsonDecoder } from '../src/kernel/socket/index.js';

/** A short temp GNOMON_HOME under realpath(os.tmpdir()) — never a literal /tmp path on macOS. */
export function tempHome(prefix = 'gd-'): { home: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(realpathSync(os.tmpdir()), prefix));
  const home = path.join(root, 'h');
  return { home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** A raw NDJSON connection that collects decoded frames. */
export async function rawConnect(socketPath: string): Promise<{
  conn: net.Socket;
  frames: Record<string, unknown>[];
  send: (v: unknown) => void;
  next: (n?: number, timeoutMs?: number) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}> {
  const conn = net.connect(socketPath);
  await new Promise<void>((res, rej) => {
    conn.once('connect', () => res());
    conn.once('error', rej);
  });
  const decoder = new NdjsonDecoder();
  const frames: Record<string, unknown>[] = [];
  conn.on('data', (c: Buffer) => {
    for (const item of decoder.push(c)) if (item.kind === 'frame') frames.push(item.value);
  });
  return {
    conn,
    frames,
    send: (v) => conn.write(typeof v === 'string' || Buffer.isBuffer(v) ? v : encodeFrame(v)),
    next: async (n = 1, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      while (frames.length < n && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      return frames.splice(0, n);
    },
    close: () =>
      new Promise<void>((res) => {
        conn.once('close', () => res());
        conn.destroy();
      }),
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

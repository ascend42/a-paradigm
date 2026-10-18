/** Shared helpers for the $daemon-lifecycle / #socket tests (PR-5). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import path from 'node:path';
import { encodeFrame, NdjsonDecoder } from '../src/kernel/socket/index.js';

/**
 * A private, short root for temp homes. macOS: realpath(os.tmpdir()) is the
 * per-user 0700 dir. Linux CI: os.tmpdir() is world-writable /tmp, which the
 * daemon (correctly, §2.4) refuses as a home — use ~/.cache/gnomon-test (0700).
 */
function privateTmpRoot(): string {
  const t = realpathSync(os.tmpdir());
  if ((statSync(t).mode & 0o002) === 0) return t;
  const root = path.join(os.homedir(), '.cache', 'gnomon-test');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return realpathSync(root);
}

/** A short temp GNOMON_HOME under a private (non-world-writable) root — never under /tmp. */
export function tempHome(prefix = 'gd-'): { home: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(privateTmpRoot(), prefix));
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

/** A fixed hello clientNonce for raw-hello tests (T-2026-10-18-016): 32 bytes, base64url. Real clients draw a fresh one per hello. */
export const TEST_CLIENT_NONCE = 'q2Nh3ZUc0kPq6vBv8w1mEa1tYxQnJw7oZrF5K9dL2sM';

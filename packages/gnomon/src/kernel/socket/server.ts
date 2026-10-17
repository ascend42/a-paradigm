/**
 * #socket (spec §4.9, §2.4 rule 1, G-DMN-02) — the unix-socket server.
 *
 * Binds under a 0177 umask, chmods 0600 and READS THE MODE BACK (owner, socket
 * type, 0600) before serving; refuses otherwise. Per connection: an
 * NdjsonDecoder, a serial reply chain (frames on one connection answer in
 * order), BAD_REQUEST for malformed and oversize lines (the connection stays
 * open), and connect/disconnect callbacks the daemon uses for idle accounting.
 * Node has no peer-credential API: the endpoint ACL plus the M1.4 mutual
 * signatures are the boundary.
 */
import * as fs from 'node:fs';
import * as net from 'node:net';
import { currentUid } from '../lifecycle/home.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { encodeFrame, MAX_FRAME_BYTES, NdjsonDecoder } from './framing.js';
import { errorFrame, parseRequest, resultFrame, RpcRefusal, type RpcRequestFrame, type RpcResponseFrame } from './rpc.js';

export const SOCKET_MODE = 0o600;

export interface ConnectionContext {
  connId: string;
}

export type RpcHandler = (frame: RpcRequestFrame, ctx: ConnectionContext) => unknown | Promise<unknown>;

/** Socket-level events, named after the §9.1 `socket` kinds. */
export type SocketEvent =
  | { kind: 'socket.connect'; connId: string }
  | { kind: 'socket.disconnect'; connId: string }
  | { kind: 'socket.frame.refused'; connId: string; code: number; reason: string };

export interface SocketServerOptions {
  socketPath: string;
  handle: RpcHandler;
  maxFrameBytes?: number;
  onConnect?: (ctx: ConnectionContext) => void;
  onDisconnect?: (ctx: ConnectionContext) => void;
  onEvent?: (event: SocketEvent) => void;
}

export interface SocketServerHandle {
  readonly socketPath: string;
  connections(): number;
  close(): Promise<void>;
}

/** Owner, socket type and exact mode, read back from the filesystem. */
export function verifySocketAcl(socketPath: string, mode: number = SOCKET_MODE): void {
  const st = fs.lstatSync(socketPath);
  if (!st.isSocket()) throw new LifecycleRefusal('endpoint-acl', `${socketPath} is not a socket`);
  const uid = currentUid();
  if (uid !== null && st.uid !== uid) {
    throw new LifecycleRefusal('endpoint-acl', `${socketPath} is owned by uid ${st.uid}, not ${uid}`);
  }
  const got = st.mode & 0o777;
  if (got !== mode) {
    throw new LifecycleRefusal('endpoint-acl', `${socketPath} mode ${got.toString(8)} is not ${mode.toString(8)}`);
  }
}

/** process.umask(mask) throws in worker threads; the chmod + read-back still holds there. */
function trySetUmask(mask: number): number | null {
  try {
    return process.umask(mask);
  } catch {
    return null;
  }
}

export async function listenSocket(opts: SocketServerOptions): Promise<SocketServerHandle> {
  const maxFrameBytes = opts.maxFrameBytes ?? MAX_FRAME_BYTES;
  const sockets = new Set<net.Socket>();
  let nextConn = 1;

  const server = net.createServer((conn) => {
    const ctx: ConnectionContext = { connId: `c${nextConn++}` };
    sockets.add(conn);
    opts.onEvent?.({ kind: 'socket.connect', connId: ctx.connId });
    opts.onConnect?.(ctx);
    const decoder = new NdjsonDecoder(maxFrameBytes);
    let chain: Promise<void> = Promise.resolve();

    const send = (frame: RpcResponseFrame): void => {
      if (conn.destroyed || !conn.writable) return;
      let bytes: Buffer;
      try {
        bytes = encodeFrame(frame); // outbound is always the §4.9 limit; maxFrameBytes bounds INBOUND lines
      } catch {
        bytes = encodeFrame(
          errorFrame(frame.id, { code: 'ENGINE', reason: 'response-too-large', message: 'response exceeds the frame limit' }),
        );
      }
      conn.write(bytes);
    };
    const refuse = (reason: string, message: string): void => {
      const frame = errorFrame(null, { code: 'BAD_REQUEST', reason, message });
      opts.onEvent?.({ kind: 'socket.frame.refused', connId: ctx.connId, code: frame.error.code, reason });
      chain = chain.then(() => send(frame));
    };

    conn.on('data', (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        if (item.kind === 'oversize') {
          refuse('frame-too-large', `frame of ${item.bytes} bytes exceeds ${maxFrameBytes}; discarded to its newline`);
        } else if (item.kind === 'malformed') {
          refuse(`malformed-${item.reason}`, 'unparseable frame (one JSON object per line)');
        } else if (item.kind === 'frame') {
          const parsed = parseRequest(item.value);
          if (!parsed.ok) {
            opts.onEvent?.({
              kind: 'socket.frame.refused',
              connId: ctx.connId,
              code: errorFrame(parsed.id, parsed.refusal).error.code,
              reason: parsed.refusal.reason,
            });
            const frame = errorFrame(parsed.id, parsed.refusal);
            chain = chain.then(() => send(frame));
            continue;
          }
          const req = parsed.frame;
          const isNotification = !Object.hasOwn(req, 'id');
          chain = chain.then(async () => {
            let resp: RpcResponseFrame;
            try {
              resp = resultFrame(req.id ?? null, await opts.handle(req, ctx));
            } catch (err) {
              resp =
                err instanceof RpcRefusal
                  ? errorFrame(req.id ?? null, err.refusal)
                  : errorFrame(req.id ?? null, { code: 'ENGINE', reason: 'internal', message: 'internal error' });
            }
            if (!isNotification) send(resp);
          });
        }
      }
    });
    conn.on('error', () => {
      /* peer went away mid-write */
    });
    conn.on('close', () => {
      decoder.end();
      sockets.delete(conn);
      opts.onEvent?.({ kind: 'socket.disconnect', connId: ctx.connId });
      opts.onDisconnect?.(ctx);
    });
  });

  await new Promise<void>((resolve, reject) => {
    const previous = trySetUmask(0o177);
    const restore = (): void => {
      if (previous !== null) trySetUmask(previous);
    };
    server.once('error', (err: NodeJS.ErrnoException) => {
      restore();
      if (err.code === 'EADDRINUSE') {
        reject(new LifecycleRefusal('endpoint-busy', `${opts.socketPath} is in use`, { socketPath: opts.socketPath }));
      } else reject(err);
    });
    server.listen(opts.socketPath, () => {
      restore();
      resolve();
    });
  });

  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    });

  try {
    fs.chmodSync(opts.socketPath, SOCKET_MODE);
    verifySocketAcl(opts.socketPath);
  } catch (err) {
    await close();
    throw err;
  }

  return {
    socketPath: opts.socketPath,
    connections: () => sockets.size,
    close,
  };
}

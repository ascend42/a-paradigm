/**
 * @symbol #socket
 *
 * #socket (spec §4.9, §2.4 rule 1, G-DMN-02) — the unix-socket server.
 *
 * Binds under a 0177 umask, chmods 0600 and READS THE MODE BACK (owner, socket
 * type, 0600) before serving; refuses otherwise. Per connection: an
 * NdjsonDecoder, a serial reply chain (frames on one connection answer in
 * order), BAD_REQUEST for malformed and oversize lines (the connection stays
 * open), and connect/disconnect callbacks the daemon uses for idle accounting.
 * Node has no peer-credential API: the endpoint ACL plus the M1.4 mutual
 * signatures (auth.ts, dispatch.ts) are the boundary. A handler refusal with
 * `closeAfter` is answered, then the connection is ended and every later frame
 * on it is ignored (§4.9: failed auth closes after one AUTH refusal).
 *
 * Socket ownership (T-2026-10-19-009 item 2, Orca audit "Adopt 2"): the
 * directory must be ours and 0700 (assertPrivateDir), so there is no
 * bind-then-chmod window. The server binds a PRIVATE random sibling name,
 * chmods and reads it back, then publishes it: link() when the public name is
 * free, else rename() over it only after a connect probe proved the old
 * holder dead (ECONNREFUSED). A connect that succeeds is a live holder; a
 * timeout, EPERM or any other error is "undecided" — both are refused
 * (`endpoint-busy`, detail.holder) and the old socket is never deleted.
 * Node's server.close() silently unlinks the BIND name; that is the private
 * name, so close never unlinks the public one. close() removes the public
 * name itself only while its dev+ino still equal the socket we published
 * (pinned by our still-bound listener, so not recycled): a successor's socket
 * is never removed. Peer uid: Node has no getpeereid/SO_PEERCRED; the 0700
 * directory plus the 0600 socket and the M1.4 mutual signatures are the
 * boundary (documented, not a runtime uid check).
 *
 * M1.4 slice 2: the context also exposes server→client NOTIFICATIONS
 * (`notify`, used by log.read{follow} subscriptions), the connection's unsent
 * byte count and high-water mark, a drain hook, and `afterReply` (run right
 * after the current request's reply is written, so a subscription's first
 * `event` can never overtake the reply that names it).
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { monotonicUlidFactory, mintId } from '@a-company/gnomon-contracts';
import { currentUid } from '../lifecycle/home.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { type DecodedItem, encodeFrame, MAX_FRAME_BYTES, NdjsonDecoder } from './framing.js';
import { errorFrame, notificationFrame, parseRequest, refusalWith, resultFrame, RpcRefusal, type RpcRequestFrame, type RpcResponseFrame } from './rpc.js';

export const SOCKET_MODE = 0o600;

export interface ConnectionContext {
  connId: string;
  /** End this connection now (pre-auth deadlines and caps, dispatch.ts). */
  close(): void;
  /** Lift the inbound frame limit from the pre-auth cap to the full limit (called on auth success). */
  authenticated(): void;
  /** Write a JSON-RPC notification (no id). False if the connection is gone or closing; THROWS if the frame cannot be encoded (over the cap). */
  notify(method: string, params: unknown): boolean;
  /** True once the connection closed: queued work for it must not run (dispatch never re-creates its state). */
  readonly closed: boolean;
  /** Bytes written but not yet flushed to the peer (net.Socket.writableLength). */
  writableLength(): number;
  /** The connection's write high-water mark (bytes), never below the socket's own writableHighWaterMark (so 'drain' always follows a pause). */
  readonly writeHighWater: number;
  /**
   * The low-water mark (≤ writeHighWater): a writer that stopped at the high
   * mark resumes only once the unsent bytes are at or below this (hysteresis,
   * T-2026-10-19-009 item 6). Absent ⇒ writeHighWater (no hysteresis).
   */
  readonly writeLowWater?: number;
  /** Call `fn` once on the next 'drain'; returns an unregister function. */
  onDrain(fn: () => void): () => void;
  /** Run `fn` right after the reply to the request being handled is written. */
  afterReply(fn: () => void): void;
}

/** Inbound frame cap until the connection authenticates (Aegis round 3). */
export const PRE_AUTH_MAX_FRAME_BYTES = 16 * 1024;

/** Per-connection flow control (Aegis round 2): queued requests and unsent reply bytes. */
export const DEFAULT_MAX_IN_FLIGHT = 32;
export const DEFAULT_WRITE_HIGH_WATER = 1024 * 1024;
/** Resume reading / pumping once unsent bytes are back at or below this (high/low hysteresis). */
export const DEFAULT_WRITE_LOW_WATER = 256 * 1024;
/**
 * Hard cap on one connection's unsent bytes (Aegis M1): a peer that stops reading while requests it already sent
 * keep producing replies is destroyed once its buffer passes this, the way web-child.ts closes a WebSocket at
 * maxSocketBuffer (8 MiB, 1008). No frame is sent: the buffer that would carry it is the problem.
 */
export const DEFAULT_MAX_WRITE_BUFFER = 8 * 1024 * 1024;
/** Concurrent unix-socket connections (Aegis M1); excess connects are dropped by net.Server.maxConnections. */
export const DEFAULT_MAX_CONNECTIONS = 64;

export type RpcHandler = (frame: RpcRequestFrame, ctx: ConnectionContext) => unknown | Promise<unknown>;

/** Socket-level events, named after the §9.1 `socket` kinds. */
export type SocketEvent =
  | { kind: 'socket.connect'; connId: string }
  | { kind: 'socket.disconnect'; connId: string }
  | { kind: 'socket.frame.refused'; connId: string; code: number; reason: string };

export interface SocketServerOptions {
  socketPath: string;
  /** How long a connect probe may take before the old holder is "undecided" (default 1 s). */
  holderProbeMs?: number;
  handle: RpcHandler;
  maxFrameBytes?: number;
  /** Inbound frame cap before auth (default 16 KiB, never above maxFrameBytes). */
  preAuthMaxFrameBytes?: number;
  /** Requests queued on one connection before reading pauses (default 32). */
  maxInFlight?: number;
  /** Unsent reply bytes on one connection before reading pauses (default 1 MiB). */
  writeHighWater?: number;
  /** Unsent bytes at or below which a paused connection resumes (default 256 KiB, clamped to writeHighWater). */
  writeLowWater?: number;
  /** Unsent bytes past which the connection is destroyed (default 8 MiB). */
  maxWriteBuffer?: number;
  /** Concurrent connections accepted (default 64); further connects are dropped by the server. */
  maxConnections?: number;
  onConnect?: (ctx: ConnectionContext) => void;
  onDisconnect?: (ctx: ConnectionContext) => void;
  onEvent?: (event: SocketEvent) => void;
  /** Test seam: observes close()'s steps in order (pins "unlink the public name BEFORE server.close()"). */
  traceClose?: (step: 'unlink-public' | 'server-close') => void;
}

export interface SocketServerHandle {
  readonly socketPath: string;
  connections(): number;
  /** Times any connection paused reading for backpressure (diagnostic/tests). */
  stats(): { pauses: number; maxQueued: number; overflows: number };
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

export const DEFAULT_HOLDER_PROBE_MS = 1_000;

/** The socket directory must be ours and 0700 (no group/other bits): no bind-then-chmod window exists inside it. */
export function assertPrivateDir(dir: string): void {
  const st = fs.lstatSync(dir);
  const uid = currentUid();
  if (!st.isDirectory()) throw new LifecycleRefusal('endpoint-acl', `${dir} is not a directory`);
  if (uid !== null && st.uid !== uid) throw new LifecycleRefusal('endpoint-acl', `${dir} is owned by uid ${st.uid}, not ${uid}`);
  if (uid !== null && (st.mode & 0o077) !== 0) throw new LifecycleRefusal('endpoint-acl', `${dir} mode ${(st.mode & 0o777).toString(8)} is not 0700: the socket would be reachable during bind`);
}

/** A short random sibling name (sun_path is ~104 bytes): `.s<8 hex>` beside the public name. */
function privateBindName(socketPath: string): string {
  return path.join(path.dirname(socketPath), `.s${randomBytes(4).toString('hex')}`);
}

export type HolderProbe = { holder: 'alive' } | { holder: 'dead' } | { holder: 'gone' } | { holder: 'undecided'; why: string };

/**
 * Prove the holder of a unix socket dead by connecting (§2.4 rule 1, Orca audit "Adopt 2"): ECONNREFUSED is the
 * ONLY proof of death; ENOENT means nothing is there; a connect is alive; a timeout, EPERM, EACCES or anything
 * else is UNDECIDED — "can't tell" is never "dead".
 */
export function probeSocketHolder(socketPath: string, timeoutMs: number = DEFAULT_HOLDER_PROBE_MS, connect: (p: string) => net.Socket = (p) => net.createConnection(p)): Promise<HolderProbe> {
  return new Promise((resolve) => {
    let done = false;
    const s = connect(socketPath);
    const finish = (r: HolderProbe): void => {
      if (done) return;
      done = true;
      clearTimeout(t);
      s.destroy();
      resolve(r);
    };
    const t = setTimeout(() => finish({ holder: 'undecided', why: 'timeout' }), timeoutMs);
    s.once('connect', () => finish({ holder: 'alive' }));
    s.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') finish({ holder: 'dead' });
      else if (err.code === 'ENOENT') finish({ holder: 'gone' });
      else finish({ holder: 'undecided', why: err.code ?? 'error' });
    });
  });
}

/**
 * Publish the privately bound socket at `target`: link() when the name is free (never replaces anything); when
 * the name is taken, replace it by rename() ONLY after probeSocketHolder proved the old holder dead. A live or
 * undecided holder is refused and its socket is left in place.
 */
async function publishSocket(bindPath: string, target: string, probeMs: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.linkSync(bindPath, target);
      fs.unlinkSync(bindPath);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP') throw err;
      // EPERM/ENOTSUP: no link() on this filesystem — fall through to probe + rename
    }
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(target);
    } catch {
      st = null;
    }
    if (st && !st.isSocket()) throw new LifecycleRefusal('endpoint-busy', `${target} exists and is not a socket; not touching it`, { socketPath: target, holder: 'not-a-socket' });
    const probe: HolderProbe = st ? await probeSocketHolder(target, probeMs) : { holder: 'gone' };
    if (probe.holder === 'alive') throw new LifecycleRefusal('endpoint-busy', `${target} is held by a live process that answers connect`, { socketPath: target, holder: 'alive' });
    if (probe.holder === 'undecided') {
      throw new LifecycleRefusal('endpoint-busy', `cannot prove the holder of ${target} dead (${probe.why}); refusing to reclaim it — stop the other process or remove the socket by hand once it is surely dead`, { socketPath: target, holder: 'undecided', why: probe.why });
    }
    if (probe.holder === 'dead' || st === null) {
      fs.renameSync(bindPath, target); // atomic replace of a proven-dead (or absent) name
      return;
    }
    // 'gone' while lstat saw it: raced away — retry the link
  }
  throw new LifecycleRefusal('endpoint-busy', `${target}: persistent race while publishing the socket`, { socketPath: target });
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
  const maxInFlight = opts.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
  const preAuthMax = opts.preAuthMaxFrameBytes ?? PRE_AUTH_MAX_FRAME_BYTES;
  const writeHighWater = opts.writeHighWater ?? DEFAULT_WRITE_HIGH_WATER;
  const writeLowWater = Math.min(opts.writeLowWater ?? DEFAULT_WRITE_LOW_WATER, writeHighWater);
  const maxWriteBuffer = opts.maxWriteBuffer ?? DEFAULT_MAX_WRITE_BUFFER;
  const stats = { pauses: 0, maxQueued: 0, overflows: 0 };
  const nextUlid = monotonicUlidFactory();
  const mintConnId = (): string => mintId('conn', nextUlid());

  const server = net.createServer((conn) => {
    let limit = Math.min(preAuthMax, maxFrameBytes);
    let afterReply: Array<() => void> = [];
    let closing = false;
    let closed = false;
    // ONE high mark for the context and for pressure(): never below the socket's own writableHighWaterMark, so a
    // writer stopped above it has had a write return false and a 'drain' is guaranteed (T-2026-10-19-009 item 6).
    const hw = Math.max(writeHighWater, conn.writableHighWaterMark);
    // The low mark is ALSO kept at or above the socket's writableHighWaterMark (fix 5): a drain listener that finds
    // writableLength above the low mark waits for the NEXT 'drain', and Node emits one only after a write returned
    // false, i.e. only when writableLength ≥ writableHighWaterMark. With low ≥ that mark, "still above low" implies
    // a further 'drain' is coming — the re-check can never stall.
    const lw = Math.min(hw, Math.max(writeLowWater, conn.writableHighWaterMark));
    /** Hard cap (Aegis M1): destroy a connection whose unsent bytes pass maxWriteBuffer. True if it did. */
    const overflowed = (): boolean => {
      if (conn.writableLength <= maxWriteBuffer) return false;
      stats.overflows++;
      closing = true;
      conn.destroy();
      return true;
    };
    const ctx: ConnectionContext = {
      connId: mintConnId(), // event:v1 connId = conn:<ULID>
      close: () => conn.destroy(),
      authenticated: () => {
        limit = maxFrameBytes;
        decoder.setMaxFrameBytes(maxFrameBytes);
      },
      notify: (method, params) => {
        if (closing || conn.destroyed || !conn.writable) return false;
        conn.write(encodeFrame(notificationFrame(method, params))); // throws over the outbound cap
        return !overflowed();
      },
      get closed() {
        return closed;
      },
      writableLength: () => conn.writableLength,
      writeHighWater: hw,
      writeLowWater: lw,
      onDrain: (fn) => {
        conn.once('drain', fn);
        return () => void conn.off('drain', fn);
      },
      afterReply: (fn) => void afterReply.push(fn),
    };
    sockets.add(conn);
    opts.onEvent?.({ kind: 'socket.connect', connId: ctx.connId });
    opts.onConnect?.(ctx);
    const decoder = new NdjsonDecoder(limit);
    let chain: Promise<void> = Promise.resolve();
    // Flow control: pause reading while too many requests are queued or too
    // many reply bytes are unsent; resume once both drain. The cap holds
    // INSIDE a chunk too (Aegis M1): frames decoded past maxInFlight wait in
    // `held` (at most one inbound chunk's worth, since reading is paused) and
    // are admitted as earlier requests settle — never run, never answered BUSY.
    let queued = 0;
    let paused = false;
    let held: DecodedItem[] = [];
    const pressure = (): boolean => queued >= maxInFlight || conn.writableLength > hw;
    // resume below the LOW mark only (hysteresis): no pause/resume flapping around one threshold
    const relieved = (): boolean => queued < maxInFlight && conn.writableLength <= lw;
    const maybePause = (): void => {
      if (!paused && pressure() && !conn.destroyed) {
        paused = true;
        stats.pauses++;
        conn.pause();
      }
      if (queued > stats.maxQueued) stats.maxQueued = queued;
    };
    const maybeResume = (): void => {
      if (held.length > 0) admitHeld();
      if (paused && held.length === 0 && relieved() && !conn.destroyed) {
        paused = false;
        conn.resume();
      }
    };
    conn.on('drain', maybeResume);
    const enqueue = (job: () => void | Promise<void>): void => {
      queued++;
      chain = chain.then(job).finally(() => {
        queued--;
        maybeResume();
      });
      maybePause();
    };

    const send = (frame: RpcResponseFrame): void => {
      if (conn.destroyed || !conn.writable) return;
      let bytes: Buffer;
      try {
        bytes = encodeFrame(frame); // outbound is always the §4.9 limit; maxFrameBytes bounds INBOUND lines
      } catch {
        bytes = encodeFrame(errorFrame(frame.id, refusalWith('ENGINE', 'response-too-large', 'response exceeds the frame limit')));
      }
      conn.write(bytes);
      if (overflowed()) return;
      maybePause();
    };
    const refuse = (reason: string, message: string): void => {
      const frame = errorFrame(null, refusalWith('BAD_REQUEST', reason, message));
      opts.onEvent?.({ kind: 'socket.frame.refused', connId: ctx.connId, code: frame.error.code, reason });
      enqueue(() => send(frame));
    };

    const admit = (item: DecodedItem): void => {
      if (item.kind === 'oversize') {
        refuse('frame-too-large', `frame of ${item.bytes} bytes exceeds ${limit}; discarded to its newline`);
      } else if (item.kind === 'malformed') {
        refuse(`malformed-${item.reason}`, 'unparseable frame (one JSON object per line)');
      } else if (item.kind === 'frame') {
        const parsed = parseRequest(item.value);
        if (!parsed.ok) {
          opts.onEvent?.({
            kind: 'socket.frame.refused',
            connId: ctx.connId,
            code: errorFrame(parsed.id, parsed).error.code,
            reason: String(parsed.refusal.data?.reason ?? ''),
          });
          const frame = errorFrame(parsed.id, parsed);
          enqueue(() => send(frame));
          return;
        }
        const req = parsed.frame;
        const isNotification = !Object.hasOwn(req, 'id');
        enqueue(async () => {
          if (closing || closed) return; // never run a queued request for a connection that is gone
          let resp: RpcResponseFrame;
          let closeAfter = false;
          try {
            resp = resultFrame(req.id ?? null, await opts.handle(req, ctx));
          } catch (err) {
            if (err instanceof RpcRefusal) {
              resp = errorFrame(req.id ?? null, { refusal: err.refusal, message: err.message });
              closeAfter = err.closeAfter;
            } else resp = errorFrame(req.id ?? null, refusalWith('ENGINE', 'internal', 'internal error'));
          }
          const after = afterReply;
          afterReply = [];
          if (closeAfter) {
            closing = true;
            send(resp); // answered even for a notification: the close needs its reason
            conn.end();
            return;
          }
          if (!isNotification) send(resp);
          for (const fn of after) fn();
        });
      }
    };
    /** Admit held frames, in order, while there is room under maxInFlight. */
    const admitHeld = (): void => {
      let i = 0;
      while (i < held.length && !closing && queued < maxInFlight) admit(held[i++]!);
      held = closing ? [] : held.slice(i);
    };

    conn.on('data', (chunk: Buffer) => {
      if (closing) return;
      const items = decoder.push(chunk);
      held = held.length > 0 ? held.concat(items) : items;
      admitHeld();
      if (held.length > 0 && !paused && !conn.destroyed) {
        paused = true; // the rest of this chunk waits; read nothing more until it is admitted
        stats.pauses++;
        conn.pause();
      }
    });
    conn.on('error', () => {
      /* peer went away mid-write */
    });
    conn.on('close', () => {
      closed = true;
      decoder.end();
      sockets.delete(conn);
      opts.onEvent?.({ kind: 'socket.disconnect', connId: ctx.connId });
      opts.onDisconnect?.(ctx);
    });
  });

  server.maxConnections = opts.maxConnections ?? DEFAULT_MAX_CONNECTIONS;

  // A named pipe (Windows parity phase) has no directory, link or rename: bind it directly.
  const pipe = opts.socketPath.startsWith('\\\\.\\pipe\\') || opts.socketPath.startsWith('\\\\?\\pipe\\');
  if (!pipe) assertPrivateDir(path.dirname(opts.socketPath));
  const bindPath = pipe ? opts.socketPath : privateBindName(opts.socketPath);
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
    server.listen(bindPath, () => {
      restore();
      resolve();
    });
  });

  /** dev+ino of the socket WE published at socketPath; pinned while our listener is bound, so it cannot be recycled before close. */
  let published: { dev: number; ino: number } | null = null;
  const close = (): Promise<void> =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      // ORDER IS LOAD-BEARING (Aegis's condition for the dev+ino unlink): the compare-and-unlink below MUST run
      // BEFORE server.close(). While our listener is still bound it pins the published inode, so the inode cannot
      // be freed and recycled by a successor's socket; after server.close() the inode can be reused (Linux reuses
      // inodes eagerly) and a successor's socket at socketPath could match our dev+ino and be wrongly unlinked.
      // Pinned by test/socket-ownership.test.ts ("close unlinks before server.close").
      // libuv unlinks the BIND name on close; that is the private name, never socketPath. The public name is
      // removed only here, and only while it is still the inode our live listener pins (a successor's socket is a different inode).
      if (published && !pipe) {
        try {
          const st = fs.lstatSync(opts.socketPath);
          if (st.dev === published.dev && st.ino === published.ino) {
            fs.unlinkSync(opts.socketPath);
            opts.traceClose?.('unlink-public');
          }
        } catch {
          /* already gone */
        }
      }
      opts.traceClose?.('server-close');
      server.close(() => resolve());
    });

  try {
    // A named pipe has no file mode, owner or inode: chmod/lstat on \\.\pipe\… would throw a plain Error
    // (exit 70, restartable ⇒ a restart loop on Windows). Its ACL is the pipe's default DACL (owner + SYSTEM).
    if (!pipe) {
      fs.chmodSync(bindPath, SOCKET_MODE);
      verifySocketAcl(bindPath);
      await publishSocket(bindPath, opts.socketPath, opts.holderProbeMs ?? DEFAULT_HOLDER_PROBE_MS);
      const st = fs.lstatSync(opts.socketPath);
      published = { dev: st.dev, ino: st.ino };
      verifySocketAcl(opts.socketPath);
    }
  } catch (err) {
    await close();
    if (!pipe) {
      try {
        fs.unlinkSync(bindPath);
      } catch {
        /* libuv already removed it */
      }
    }
    throw err;
  }

  return {
    socketPath: opts.socketPath,
    connections: () => sockets.size,
    stats: () => ({ ...stats }),
    close,
  };
}

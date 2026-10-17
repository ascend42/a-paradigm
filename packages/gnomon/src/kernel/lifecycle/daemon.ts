/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4) — the PR-5 core: home (0700, read back) →
 * endpoint path (never /tmp) → O_EXCL pidfile lock → #socket at 0600 → idle
 * monitor. Exit paths (idle, signal) close the socket and release the lock
 * only if it is still ours.
 *
 * Not yet here (later milestones): `#kernel-log` writes (events go to
 * `onEvent`, named after the §9.1 `daemon`/`socket` kinds), sessions, mods,
 * timers, the web endpoint, orphan sweep, `hello`/`auth` (M1.4) and an
 * approved `stop` (#approval-broker, M1.6).
 */
import { RpcRefusal, type RpcHandler, type SocketEvent, type SocketServerHandle, listenSocket } from '../socket/index.js';
import { selectSocketPath, type EndpointVia } from './endpoint.js';
import { ensureGnomonHome } from './home.js';
import { DEFAULT_IDLE_EXIT_MS, IdleMonitor } from './idle.js';
import { acquireDaemonLock, releaseDaemonLock, type DaemonPidfile } from './pidfile.js';
import { LifecycleRefusal } from './refusal.js';

export type DaemonExitReason = 'idle' | 'signal' | 'error';

/** Events named after the §9.1 `daemon` and `socket` kinds; the kernel log takes them at M1.2. */
export type DaemonEvent =
  | { kind: 'daemon.start'; pid: number; socketPath: string; via: EndpointVia; idleMs: number }
  | { kind: 'daemon.exit'; reason: DaemonExitReason }
  | { kind: 'daemon.lock.refused'; reason: string; holderPid?: number }
  | SocketEvent;

export interface DaemonOptions {
  home: string;
  idleMs?: number;
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  maxFrameBytes?: number;
  onEvent?: (event: DaemonEvent) => void;
}

export interface DaemonStatus {
  pid: number;
  startedAt: string;
  socketPath: string;
  via: EndpointVia;
  connections: number;
  idleMs: number;
  uptimeMs: number;
}

export interface DaemonHandle {
  readonly pidfile: DaemonPidfile;
  readonly via: EndpointVia;
  status(): DaemonStatus;
  /** Resolves once the daemon has fully stopped. */
  readonly exited: Promise<DaemonExitReason>;
  shutdown(reason: DaemonExitReason): Promise<void>;
}

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  const emit = (e: DaemonEvent): void => opts.onEvent?.(e);
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_EXIT_MS;
  const home = ensureGnomonHome(opts.home);

  const choice = selectSocketPath({ home, ...(opts.platform ? { platform: opts.platform } : {}), ...(opts.env ? { env: opts.env } : {}) });
  if (!choice.ok) {
    throw new LifecycleRefusal('no-safe-endpoint', choice.reason, { candidates: choice.candidates });
  }

  let pidfile: DaemonPidfile;
  try {
    pidfile = acquireDaemonLock(home, process.pid, { socketPath: choice.path });
  } catch (err) {
    if (err instanceof LifecycleRefusal) {
      const holderPid = typeof err.detail.pid === 'number' ? err.detail.pid : undefined;
      emit({ kind: 'daemon.lock.refused', reason: err.reason, ...(holderPid !== undefined ? { holderPid } : {}) });
    }
    throw err;
  }

  const startedMs = Date.now();
  const releases = new Map<string, () => void>();
  let server: SocketServerHandle | null = null;
  let stopping: Promise<void> | null = null;
  let resolveExited!: (r: DaemonExitReason) => void;
  const exited = new Promise<DaemonExitReason>((r) => (resolveExited = r));

  const shutdown = (reason: DaemonExitReason): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      idle.stop();
      emit({ kind: 'daemon.exit', reason });
      try {
        await server?.close();
      } finally {
        releaseDaemonLock(home, pidfile);
        resolveExited(reason);
      }
    })();
    return stopping;
  };

  const idle = new IdleMonitor({ idleMs, onIdle: () => void shutdown('idle') });

  const status = (): DaemonStatus => ({
    pid: pidfile.pid,
    startedAt: pidfile.startedAt,
    socketPath: pidfile.socketPath,
    via: choice.via,
    connections: server?.connections() ?? 0,
    idleMs,
    uptimeMs: Date.now() - startedMs,
  });

  const handle: RpcHandler = (frame) => {
    switch (frame.method) {
      case 'hello':
        throw new RpcRefusal('ENGINE', 'not-implemented', 'hello negotiation and mutual auth arrive with #socket at M1.4', {
          verb: 'hello',
          milestone: 'M1.4',
        });
      case 'daemon.status':
        return status();
      case 'daemon.stop':
        throw new RpcRefusal('ENGINE', 'not-implemented', 'daemon.stop needs an approval (#approval-broker, M1.6); the daemon exits on idle', {
          verb: 'daemon.stop',
          milestone: 'M1.6',
        });
      default:
        throw new RpcRefusal('UNKNOWN_VERB', 'unknown-verb', `unknown verb ${JSON.stringify(frame.method)}`);
    }
  };

  try {
    server = await listenSocket({
      socketPath: choice.path,
      handle,
      ...(opts.maxFrameBytes !== undefined ? { maxFrameBytes: opts.maxFrameBytes } : {}),
      onEvent: emit,
      onConnect: (ctx) => releases.set(ctx.connId, idle.hold('connection')),
      onDisconnect: (ctx) => {
        releases.get(ctx.connId)?.();
        releases.delete(ctx.connId);
      },
    });
  } catch (err) {
    releaseDaemonLock(home, pidfile);
    throw err;
  }

  idle.start();
  emit({ kind: 'daemon.start', pid: pidfile.pid, socketPath: pidfile.socketPath, via: choice.via, idleMs });
  return { pidfile, via: choice.via, status, exited, shutdown };
}

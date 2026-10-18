/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4) — the PR-5 core: home (0700, read back) →
 * endpoint path (never /tmp) → O_EXCL pidfile lock → #socket at 0600 → idle
 * monitor. Exit paths (idle, signal) close the socket and release the lock
 * only if it is still ours.
 *
 * M1.4 slice 1: after the lock, the daemon opens #kernel-log with a kernel
 * key, then serves #socket through the hello/auth dispatcher. daemon.start,
 * daemon.exit, socket.connect, socket.frame.refused and every socket.hello /
 * socket.auth.* outcome are appended to the log (and still reported to
 * `onEvent`; daemon.lock.refused stays callback-only — the refused daemon
 * does not hold the log). KERNEL KEY SEAM: the key is a software Ed25519 key
 * — `opts.kernelSigner`, or an EPHEMERAL in-memory key per daemon start,
 * never a file (§3.1); status reports custody `partial`. Only its PUBLIC half
 * is recorded in <home>/keys/kernel-pub.jsonl and every recorded key is loaded
 * into the log's key ring / kernelKeyIds, so verify works across restarts —
 * but across restarts a kernel signature proves nothing against a same-user
 * forger until M1.3 (identity/kernel-pub.ts). Pre-auth diagnostics
 * (socket.connect, socket.frame.refused, pre-auth closures) are COALESCED into
 * one signed counter row per kind per `diagFlushMs` window (default 10 s) and
 * at shutdown. socket.hello and socket.auth.fail are RATE-LIMITED: the first
 * `preAuthRowsPerWindow` (8) of each per window are written individually, the
 * rest are folded into that window's signed counter row of the same kind
 * (byOutcome / byReason); since #web-endpoint socket.auth.replay and
 * socket.auth.reconnect.requested are folded the same way. socket.auth.ok
 * stays individual. So an
 * unauthenticated flood adds at most 8 + 1 rows per kind per window. The keystore item
 * behind the signed helper is #identity M1.3. ROOT SEAM: `opts.rootAuthority`
 * defaults to UnprovisionedRootAuthority (no device can authenticate before
 * M1.3); the dev/test root is programmatic only, never env/argv (§15.3).
 *
 * M1.4 #web-endpoint: `requestWebLaunch(connId)` — the kernel side of
 * `gnomon open` for an authenticated HUMAN device connection on the unix
 * socket — starts the web endpoint on first use (web/endpoint.ts: the
 * `gnomon-web` transport child under the `transport` sandbox profile, the
 * pinned bundle) and mints a single-use launch token that is returned to the
 * caller in-process, never on any argv, env or file. The web endpoint runs its
 * own dispatcher (same verbs, log, status and read-token store rules; its
 * authenticator signs `ws://127.0.0.1:<port>/rpc`). It lingers 2 min after the
 * last GUI session and stops with the daemon. NOTE: §5 names no verb for
 * `gnomon open` and adding one is the M1.4 falsifier, so this is an
 * in-process API until the spec names the wire path (reported).
 *
 * Not yet here: sessions, mods, timers, orphan sweep and an approved `stop`
 * (#approval-broker, M1.6).
 */
import * as path from 'node:path';
import { completePendingQuarantine, KernelLog, KeyRing, SoftwareEd25519Signer, type Signer } from '../log/index.js';
import { readKernelPubs, recordKernelPub, UNPROVISIONED_NS, UnprovisionedRootAuthority, type RootAuthority } from '../identity/index.js';
import {
  createKernelDispatcher,
  SubscriptionHub,
  listenSocket,
  SocketAuthenticator,
  type SocketEvent,
  type SocketLogKind,
  type SocketServerHandle,
  type SubscriptionStats,
} from '../socket/index.js';
import { WebEndpoint, type LaunchGrant } from '../web/endpoint.js';
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
  /** A read-token revocation could not be written to the chain twice; it stays pending and is retried on the token timer. */
  | { kind: 'daemon.token.revocation.unrecorded'; tokenId: string; error: string }
  | SocketEvent;

export interface DaemonOptions {
  home: string;
  idleMs?: number;
  /** Test seam: per-subscription undelivered-frame cap (default 10 000, §4.9). */
  subscriptionBacklogCap?: number;
  platform?: NodeJS.Platform;
  env?: Readonly<Record<string, string | undefined>>;
  maxFrameBytes?: number;
  onEvent?: (event: DaemonEvent) => void;
  /** Kernel key seam (software Ed25519; default: ephemeral per start). Keystore custody is M1.3. */
  kernelSigner?: Signer;
  /** Root seam (default: UnprovisionedRootAuthority). Tests pass a DevTestRootAuthority. */
  rootAuthority?: RootAuthority;
  /** Test seam: the auth clock (nonce expiry). */
  clock?: () => number;
  /** Coalesced diagnostic row window (default 10 s). */
  diagFlushMs?: number;
  /** Individual socket.hello / socket.auth.fail rows per window before folding (default 8). */
  preAuthRowsPerWindow?: number;
  /** Pre-auth inbound frame cap (default 16 KiB). */
  preAuthMaxFrameBytes?: number;
  /** Pre-auth and flow-control seams (defaults: dispatch.ts / server.ts). */
  helloTimeoutMs?: number;
  preAuthTimeoutMs?: number;
  maxPreAuth?: number;
  /** Token-file refresh period at the daemon (default 60 s; records revocations with no live token connection). */
  tokenRefreshMs?: number;
  /** Read-token revocation re-check period (default dispatch.ts TOKEN_RECHECK_MS). */
  tokenRecheckMs?: number;
  maxInFlight?: number;
  writeHighWater?: number;
  /** #web-endpoint timing seams (defaults: 2 min linger, 5 s auth deadline). */
  web?: { lingerMs?: number; authDeadlineMs?: number };
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
  readonly log: KernelLog;
  readonly kernelSigner: Signer;
  readonly kernelPrincipal: string;
  /** Write the coalesced diagnostic rows now (tests; also runs on the window timer and at shutdown). */
  flushDiagnostics(): Promise<void>;
  readonly server: SocketServerHandle;
  /** log.read{follow} subscription telemetry (tests; status shows the counts). */
  subscriptions(): SubscriptionStats;
  status(): DaemonStatus;
  /** Resolves once the daemon has fully stopped. */
  readonly exited: Promise<DaemonExitReason>;
  shutdown(reason: DaemonExitReason): Promise<void>;
  /** `gnomon open` (kernel side): start the web endpoint if needed and mint a launch token for an authenticated human device connection. */
  requestWebLaunch(connId: string): Promise<LaunchGrant>;
  /** The web endpoint, once started (null before the first launch). */
  web(): WebEndpoint | null;
}

/** The kernel principal `p:<root ns>/kernel` (p:00000000/kernel while no root exists) — one source for the daemon and `gnomon log quarantine`. */
export function kernelPrincipalOf(authority: Pick<RootAuthority, 'ns'> = new UnprovisionedRootAuthority()): string {
  return `p:${authority.ns ?? UNPROVISIONED_NS}/kernel`;
}

export async function startDaemon(opts: DaemonOptions): Promise<DaemonHandle> {
  const emit = (e: DaemonEvent): void => opts.onEvent?.(e);
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_EXIT_MS;
  // T-2026-10-17-009(a): finish a quarantine interrupted between its two
  // renames BEFORE a home is created, so no fresh unrelated log fills the gap.
  if (path.isAbsolute(opts.home)) {
    const pending = completePendingQuarantine(opts.home);
    if (pending.conflict) throw new LifecycleRefusal('quarantine-pending', `an interrupted quarantine (${pending.conflict}) names this home, but the home and its evidence both exist`, { staging: pending.conflict });
  }
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

  const kernelSigner = opts.kernelSigner ?? SoftwareEd25519Signer.generate('kernel');
  const kernelKeySource = opts.kernelSigner ? 'supplied-software' : 'ephemeral-software';
  const authority = opts.rootAuthority ?? new UnprovisionedRootAuthority();
  const kernelPrincipal = kernelPrincipalOf(authority);
  let log: KernelLog;
  try {
    const pem = (kernelSigner as Partial<SoftwareEd25519Signer>).publicKeyPem;
    if (typeof pem === 'string') recordKernelPub(home, pem);
    const keyRing = new KeyRing();
    const pubs = readKernelPubs(home);
    for (const k of pubs) keyRing.addEd25519(k.publicKeyPem);
    log = KernelLog.open({ home, kernelPrincipal, signer: kernelSigner, keyRing, kernelKeyIds: pubs.map((k) => k.keyId) });
  } catch (err) {
    releaseDaemonLock(home, pidfile);
    throw err;
  }
  const pendingRows = new Set<Promise<unknown>>();
  const appendRow = (kind: string, payload: Record<string, unknown>, ids: { connId?: string; deviceId?: string } = {}): Promise<void> => {
    const p = log.append({ kind, principal: kernelPrincipal, payload, ...ids }).then(() => undefined);
    pendingRows.add(p);
    void p.finally(() => pendingRows.delete(p)).catch(() => undefined);
    return p;
  };
  /** Coalesced pre-auth diagnostics: counters, flushed as one signed row per kind per window. */
  const diag = {
    windowStart: new Date().toISOString(),
    connects: 0,
    refused: new Map<string, number>(),
    preAuthClosed: new Map<string, number>(),
    individual: new Map<string, number>(), // kind → individual rows written this window
    // Aegis C4: the web endpoint's Reconnect and post-TTL replay rows are attacker-triggerable too
    folded: {
      'socket.hello': new Map<string, number>(),
      'socket.auth.fail': new Map<string, number>(),
      'socket.auth.replay': new Map<string, number>(),
      'socket.auth.reconnect.requested': new Map<string, number>(),
    } as Record<string, Map<string, number>>,
  };
  const perWindow = opts.preAuthRowsPerWindow ?? 8;
  /** Rate-limited pre-auth rows: individual up to `perWindow`, then a counter increment. */
  const logSocketRow = (kind: SocketLogKind | `socket.${string}`, payload: Record<string, unknown>, ids: { connId?: string; deviceId?: string } = {}): Promise<void> => {
    const folded = diag.folded[kind];
    if (folded) {
      const n = diag.individual.get(kind) ?? 0;
      if (n >= perWindow) {
        bump(folded, String(kind === 'socket.hello' ? payload.outcome : (payload.reason ?? payload.surface ?? kind)));
        return Promise.resolve();
      }
      diag.individual.set(kind, n + 1);
    }
    return appendRow(kind, payload, ids);
  };
  const bump = (m: Map<string, number>, k: string): void => void m.set(k, (m.get(k) ?? 0) + 1);
  const flushDiagnostics = async (): Promise<void> => {
    const windowEnd = new Date().toISOString();
    const rowsOut: Array<Promise<void>> = [];
    if (diag.connects > 0 || diag.preAuthClosed.size > 0) {
      rowsOut.push(
        appendRow('socket.connect', { coalesced: true, count: diag.connects, preAuthClosed: Object.fromEntries(diag.preAuthClosed), windowStart: diag.windowStart, windowEnd }),
      );
    }
    if (diag.refused.size > 0) {
      const byReason = Object.fromEntries(diag.refused);
      rowsOut.push(
        appendRow('socket.frame.refused', { coalesced: true, count: Object.values(byReason).reduce((a, b) => a + b, 0), byReason, windowStart: diag.windowStart, windowEnd }),
      );
    }
    for (const [kind, m] of Object.entries(diag.folded)) {
      if (m.size === 0) continue;
      const by = Object.fromEntries(m);
      const count = Object.values(by).reduce((a, b) => a + b, 0);
      rowsOut.push(appendRow(kind, { coalesced: true, count, [kind === 'socket.hello' ? 'byOutcome' : 'byReason']: by, windowStart: diag.windowStart, windowEnd }));
      m.clear();
    }
    diag.individual.clear();
    diag.windowStart = windowEnd;
    diag.connects = 0;
    diag.refused.clear();
    diag.preAuthClosed.clear();
    await Promise.all(rowsOut.map((p) => p.catch(() => undefined)));
  };
  const diagTimer = setInterval(() => void flushDiagnostics(), opts.diagFlushMs ?? 10_000);
  diagTimer.unref();

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
        await web?.stop('daemon-exit').catch(() => undefined);
        hub.close();
        await server?.close();
        clearInterval(diagTimer);
        clearInterval(tokenTimer);
        await flushDiagnostics();
        await appendRow('daemon.exit', { reason }).catch(() => undefined);
        await Promise.allSettled([...pendingRows]);
        await log.close();
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

  // Read-token revocations are sticky across restarts: seed them from the chain (P8-D89, Aegis).
  const chainRevoked = new Set<string>();
  /** Revocations seen but not yet on the chain: retried, never dropped (Aegis follow-up 1). */
  const unrecorded = new Set<string>();
  const recordRevocation = async (tokenId: string): Promise<void> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await appendRow('key.token.revoked', { tokenId });
        unrecorded.delete(tokenId);
        return;
      } catch (err) {
        if (attempt === 1) {
          unrecorded.add(tokenId);
          emit({ kind: 'daemon.token.revocation.unrecorded', tokenId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  };
  for (const v of log.read({ reader: { class: 'human' }, kinds: ['key.token.revoked'] })) {
    const id = v.view === 'full' ? (v.event.payload as { tokenId?: unknown } | undefined)?.tokenId : undefined;
    if (typeof id === 'string') chainRevoked.add(id);
  }
  const authenticator = new SocketAuthenticator({
    home,
    endpointPath: choice.path,
    kernelSigner,
    trust: authority,
    readTokens: {
      revoked: chainRevoked,
      onRevoked: (tokenId) => void recordRevocation(tokenId),
      onUntrusted: (reason) => void appendRow('key.registry.malformed', { file: 'read-tokens.jsonl', reason }).catch(() => undefined),
    },
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  // Read the token file now and on a slow timer, whether or not a token connection is live,
  // so a revocation row reaches the chain promptly (Aegis follow-up 1).
  authenticator.refreshTokens();
  const tokenTimer = setInterval(() => {
    authenticator.refreshTokens();
    for (const id of [...unrecorded]) void recordRevocation(id);
  }, opts.tokenRefreshMs ?? 60_000);
  tokenTimer.unref();
  const hub = new SubscriptionHub({
    log,
    holdIdle: () => idle.hold('subscriber'),
    onDropped: (connId, payload) => void appendRow('socket.subscription.dropped', payload, { connId }).catch(() => undefined),
    ...(opts.subscriptionBacklogCap !== undefined ? { backlogCap: opts.subscriptionBacklogCap } : {}),
  });
  let web: WebEndpoint | null = null;
  const statusSource = {
    daemon: () => ({ ...status() }),
    log: () => ({ ...log.head() }),
    kernelKey: () => ({ keyId: kernelSigner.keyId, custody: 'partial' as const, source: kernelKeySource }),
    root: () => ({ state: authority.state, rootKeyId: authority.rootKeyId }),
    web: () => web?.status() ?? { listening: false },
  };
  const dispatcherCommon = {
    reads: { log, hub },
    ...(opts.helloTimeoutMs !== undefined ? { helloTimeoutMs: opts.helloTimeoutMs } : {}),
    ...(opts.preAuthTimeoutMs !== undefined ? { preAuthTimeoutMs: opts.preAuthTimeoutMs } : {}),
    ...(opts.maxPreAuth !== undefined ? { maxPreAuth: opts.maxPreAuth } : {}),
    ...(opts.tokenRecheckMs !== undefined ? { tokenRecheckMs: opts.tokenRecheckMs } : {}),
    onPreAuthClose: (why: Parameters<NonNullable<Parameters<typeof createKernelDispatcher>[0]['onPreAuthClose']>>[0]) => bump(diag.preAuthClosed, why),
    log: logSocketRow,
    status: statusSource,
  };
  const dispatcher = createKernelDispatcher({ authenticator, ...dispatcherCommon });
  const kernelPem = (kernelSigner as Partial<SoftwareEd25519Signer>).publicKeyPem;
  const requestWebLaunch = async (connId: string): Promise<LaunchGrant> => {
    const asker = dispatcher.clients().find((c) => c.connId === connId);
    if (!asker) throw new LifecycleRefusal('web-launch-refused', 'no authenticated unix-socket connection with that connId', { connId });
    if (typeof kernelPem !== 'string') throw new LifecycleRefusal('web-launch-refused', 'the kernel key has no public PEM to hand the page (keystore custody is M1.3)');
    web ??= WebEndpoint.create({
      home,
      kernelPublicKeyPem: kernelPem,
      log: (kind, payload, ids) => logSocketRow(kind as `socket.${string}`, payload, ids),
      holdIdle: () => idle.hold('connection'),
      ...(opts.web?.lingerMs !== undefined ? { lingerMs: opts.web.lingerMs } : {}),
      ...(opts.web?.authDeadlineMs !== undefined ? { authDeadlineMs: opts.web.authDeadlineMs } : {}),
      dispatcher: (endpointPath, webHook) =>
        createKernelDispatcher({
          ...dispatcherCommon,
          web: webHook,
          authenticator: new SocketAuthenticator({
            home,
            endpointPath,
            kernelSigner,
            trust: authority,
            // revocations are recorded by the socket authenticator's store (and its timer); this store honours them
            readTokens: { revoked: chainRevoked, onRevoked: () => undefined, onUntrusted: () => undefined },
            ...(opts.clock ? { clock: opts.clock } : {}),
          }),
        }),
    });
    return web.requestLaunch(asker);
  };
  const onSocketEvent = (e: SocketEvent): void => {
    emit(e);
    if (e.kind === 'socket.connect') diag.connects++;
    else if (e.kind === 'socket.frame.refused') bump(diag.refused, e.reason);
    // socket.disconnect has no §9.1 kind: callback only (contract gap, reported).
  };

  try {
    server = await listenSocket({
      socketPath: choice.path,
      handle: dispatcher.handle,
      ...(opts.maxFrameBytes !== undefined ? { maxFrameBytes: opts.maxFrameBytes } : {}),
      ...(opts.maxInFlight !== undefined ? { maxInFlight: opts.maxInFlight } : {}),
      ...(opts.preAuthMaxFrameBytes !== undefined ? { preAuthMaxFrameBytes: opts.preAuthMaxFrameBytes } : {}),
      ...(opts.writeHighWater !== undefined ? { writeHighWater: opts.writeHighWater } : {}),
      onEvent: onSocketEvent,
      onConnect: (ctx) => {
        dispatcher.onConnect(ctx);
        releases.set(ctx.connId, idle.hold('connection'));
      },
      onDisconnect: (ctx) => {
        dispatcher.onDisconnect(ctx);
        releases.get(ctx.connId)?.();
        releases.delete(ctx.connId);
      },
    });
  } catch (err) {
    clearInterval(diagTimer);
    clearInterval(tokenTimer);
    await log.close().catch(() => undefined);
    releaseDaemonLock(home, pidfile);
    throw err;
  }

  idle.start();
  emit({ kind: 'daemon.start', pid: pidfile.pid, socketPath: pidfile.socketPath, via: choice.via, idleMs });
  await appendRow('daemon.start', {
    pid: pidfile.pid,
    socketPath: pidfile.socketPath,
    via: choice.via,
    idleMs,
    kernelKeyId: kernelSigner.keyId,
    kernelKeySource,
    kernelKeyCustody: 'partial',
    root: authority.state,
  });
  return { pidfile, via: choice.via, log, kernelSigner, kernelPrincipal, flushDiagnostics, server: server!, subscriptions: () => hub.stats(), status, exited, shutdown, requestWebLaunch, web: () => web };
}

/**
 * @symbol #web-endpoint
 *
 * #web-endpoint (spec §11.2, §4.9 WebSocket paragraph, §2.4 linger) — the
 * kernel half of the loopback web endpoint. It spawns and supervises the
 * `gnomon-web` transport child (under the `transport` sandbox profile,
 * sandbox/transport.ts), takes EVERY rule decision on the records the child
 * forwards (rules.ts), and runs the same `gnomon-rpc:v1` dispatcher as the
 * unix socket over the WebSocket — its own dispatcher instance, whose
 * authenticator signs the endpoint path `ws://127.0.0.1:<port>/rpc`.
 *
 * Lifecycle: started by the first launch request (`gnomon open`); the child
 * reports the tree hash of the bundle it loaded; a hash that is not the pin ⇒
 * socket.web.bundle.mismatch and the endpoint does not open (rule 1a).
 *
 * Listener (§11.2 rule 1, §15.5 `transport`, T-2026-10-18-020): the KERNEL
 * listens on the IPv4 literal 127.0.0.1 on an OS-chosen ephemeral port, with
 * `pauseOnConnect`, and hands each accepted socket — unread — to the child
 * with `subprocess.send('conn', socket)` over the child's IPC channel; Node
 * closes the kernel's copy when the child ACKs it (NODE_HANDLE_ACK).
 * Accept-and-forward only: the kernel never reads a byte of a connection, so
 * the child stays the only HTTP/WebSocket parser (A24-1). The child opens,
 * binds and listens on no socket (its profile has no network-* rule; probe
 * P14b-web). The listener outlives a child restart, so the port survives it;
 * a connection accepted while no child is serving is closed. stop() and the
 * restart-cap / failed-respawn paths close it.
 *
 * Hand-off bounds (Aegis C1, round 2): the listener's maxConnections is
 * WEB_MAX_PENDING_HANDOFFS (Node counts a socket until it is sent, so a child
 * that stops ACKing — Node queues every later hand-off behind the unACKed one
 * — fills the cap and further connections are closed); an ACK watchdog
 * SIGKILLs a child that leaves a hand-off unACKed past `handoffAckMs`
 * (default 5 s). The child must never speak on fd 3: any user message, and
 * any internal (NODE_*) message other than NODE_HANDLE_ACK — including a
 * NODE_HANDLE that would pass an fd INTO the kernel — kills it, and a handle
 * it attached is closed. Residual (§A.7): Node's own IPC reader parses the
 * child's fd-3 bytes as JSON lines with no length bound before any of this
 * runs — a DoS-only kernel surface reachable from a compromised child. A child that exits is restarted (cap 3 per 10 min; then
 * socket.web.stop{reason:'transport-restart-cap'}; a respawn that fails ⇒
 * socket.web.stop{reason:'transport-restart-failed'}); every GUI connection it
 * carried ends, so each page shows Reconnect (rule 1b). After the last GUI
 * session closes (and no launch token is pending) the endpoint LINGERS 2 min
 * so a reload can reach Reconnect, then stops with
 * socket.web.stop{reason:'no-sessions'} and ends the child (§2.4, D54).
 *
 * WebSocket rules: the first frame must be `hello` and the second `auth`,
 * both within 5 s of the upgrade, else the socket closes 1008 (rule 7); frames
 * before auth succeeds are never dispatched as verbs; at most 64 connections,
 * and at the cap the OLDEST UNAUTHENTICATED one is closed, never an
 * authenticated GUI connection (a new upgrade is refused 503 when all are
 * authenticated, rule 8); token exchange and Reconnect ≤ 5 attempts per
 * minute per connection (rule 8). Auth forms (§4.9): `{launchToken}` (the
 * GUI token exchange, launch.ts), `{reconnect:true}` — presence through the
 * signed helper, which is UNAVAILABLE until #identity M1.3, so Reconnect is
 * refused UNSUPPORTED{reason:'web-auth-not-implemented', milestone:'M1.3',
 * cause:'presence-unavailable'} after logging socket.auth.reconnect.requested
 * — and the socket's device form. Read tokens are REFUSED here (`auth-params`,
 * Aegis C3): a token authenticates on the unix socket only.
 *
 * HTTP: `/diag` (POST, GUI token in `X-Gnomon-Token`, ≤ 64 KiB, appended to
 * `<home>/logs/gui.log`), `/blob/<sha>` (GET, GUI token, served only when the
 * bytes hash to `<sha>` and sniff as PNG/JPEG/WebP), static bundle files
 * (served by the child from the bytes it hashed). No cookies anywhere; no
 * HTTP RPC.
 *
 * TEST SEAM: production start uses the platform's sandbox launch plan and
 * refuses where none exists. The only way to run the child unsandboxed (tests
 * on every OS) is the internal seam channel (internal-seams.ts slot `web`),
 * read only by src/kernel/testing.ts.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import * as net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mintId, monotonicUlidFactory, sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { registerSeams } from '../internal-seams.js';
import { LifecycleRefusal } from '../lifecycle/refusal.js';
import { transportLaunchPlan, type ChildLaunchPlan, type TransportLaunchInput } from '../sandbox/transport.js';
import { authFail, type AuthOutcome, type ConnAuthState, type WebAuthHook } from '../socket/auth.js';
import type { KernelDispatcher } from '../socket/dispatch.js';
import { decodeLine, encodeFrame, NdjsonDecoder } from '../socket/framing.js';
import { errorFrame, notificationFrame, parseRequest, refusalWith, resultFrame, RpcRefusal, type RpcResponseFrame } from '../socket/rpc.js';
import type { ConnectionContext } from '../socket/server.js';
import { PRE_AUTH_MAX_FRAME_BYTES } from '../socket/server.js';
import { GUI_BUNDLE_HASH, materializeGuiBundle } from './gui-pin.js';
import { GuiAccess, type GuiSession, type LaunchBinding } from './launch.js';
import {
  CHANNEL_MAX_RECORD_BYTES,
  encodeRecord,
  HTTP_MAX_BODY_BYTES,
  validateChildRecord,
  WEB_CONN_MESSAGE,
  WS_MAX_FRAME_BYTES,
  WS_MAX_SOCKET_BUFFER,
  WS_PRE_AUTH_MAX_FRAME_BYTES,
  WS_WRITE_HIGH_WATER,
  WS_WRITE_LOW_WATER,
  WS_MISSED_PONGS,
  WS_PING_MS,
  type ChildRecord,
  type HeaderMap,
  type KernelRecord,
} from './protocol.js';
import { AttemptLimiter, childDefaultHeaders, decideUpgrade, routeHttp, securityHeaders, sniffRaster, type FailReason } from './rules.js';

export const WEB_LINGER_MS = 2 * 60_000;
export const WEB_AUTH_DEADLINE_MS = 5_000;
export const WEB_MAX_CONNECTIONS = 64;
export const WEB_RESTART_CAP = Object.freeze({ max: 3, windowMs: 10 * 60_000 });
export const WEB_READY_TIMEOUT_MS = 10_000;
/** The kernel listener's maxConnections: accepted sockets not yet handed to the child (Aegis C1, round 2). */
export const WEB_MAX_PENDING_HANDOFFS = 128;
/** A hand-off the child has not ACKed within this long ⇒ the child is SIGKILLed (the restart path follows). */
export const WEB_HANDOFF_ACK_MS = 5_000;
export const GUI_LOG_MAX_BYTES = 8 * 1024 * 1024;
const WS_CLOSE_POLICY = 1008;
const WS_CLOSE_TRY_LATER = 1013;
/** Requests queued on one WebSocket before it is closed 1008 (the socket's DEFAULT_MAX_IN_FLIGHT; the child cannot pause one rid). */
export const WEB_MAX_IN_FLIGHT = 32;

/** The kernel log, as the endpoint writes it (socket.* kinds; must reject if the row was not written). */
export type WebLog = (kind: string, payload: Record<string, unknown>, ids?: { connId?: string; deviceId?: string }) => Promise<void>;

/** Blob bytes a principal may read (§9.3), by content hash; null = not found or not readable. The blob store is #kernel-log's. */
export interface BlobSource {
  read(sha256Hex: string, principal: string): Buffer | null;
}

export interface WebEndpointOptions {
  home: string;
  /** #setup-endpoint: where the bundle is materialized and gui.log goes (default: home). The setup checks are read-only, so setup mode keeps its state in a private scratch dir; the home stays protected. */
  stateDir?: string;
  /** Build the endpoint's dispatcher for `endpointPath` (`ws://127.0.0.1:<port>/rpc`) with the web auth hook. */
  dispatcher: (endpointPath: string, web: WebAuthHook) => KernelDispatcher;
  log: WebLog;
  /** The kernel's Ed25519 public key (PEM); handed to the page as base64url SPKI with the launch token. */
  kernelPublicKeyPem: string;
  holdIdle?: () => () => void;
  blobs?: BlobSource;
  /** The child entry; default: dist/transport/gnomon-web.js of this package. */
  scriptPath?: string;
  now?: () => number;
  lingerMs?: number;
  authDeadlineMs?: number;
  maxConnections?: number;
  pingMs?: number;
  missedPongs?: number;
  platform?: string;
  /** The ACK watchdog bound for a socket hand-off (default WEB_HANDOFF_ACK_MS). */
  handoffAckMs?: number;
}

/** What the test seam may substitute: the launcher and the pinned bundle. */
export interface WebEndpointSeams {
  launcher?: (input: TransportLaunchInput) => ChildLaunchPlan;
  bundle?: { dir: string; hash: string };
}

export interface LaunchGrant {
  port: number;
  launchToken: string;
  expiresAt: number;
  /** base64url SPKI DER of the kernel Ed25519 key (`#launch=<token>&k=<spki>`). */
  kernelPublicKey: string;
  bundleHash: string;
  url: string;
}

interface WsConn {
  rid: number;
  connId: string;
  ctx: ConnectionContext;
  state: { phase: 'pre-hello' | 'pre-auth' | 'authenticated'; frames: number };
  closing: boolean;
  closed: boolean;
  openedAt: number;
  limiter: AttemptLimiter;
  chain: Promise<void>;
  queued: number;
  /** Unsent bytes the child reported for this connection (0 after its `drain`). */
  pressure: number;
  drainers: Set<() => void>;
  afterReply: Array<() => void>;
  deadline: NodeJS.Timeout | null;
  release: (() => void) | null;
}

/**
 * `/diag` body redaction before gui.log (Aegis M1.10 C5). The page is
 * human-class, but gui.log is an operational file outside the chain, so it
 * keeps nothing a limited §9.3 view would withhold that the page could leak
 * by accident: every 32-byte base64url token (launch and GUI tokens are
 * exactly 43 such characters) becomes `⟨redacted⟩`, and the text passes
 * through the contracts display sanitizer so no terminal escape lands in a
 * log a human will `cat`. The 64 KiB body cap applies before this.
 */
export function redactDiagText(s: string): string {
  const scrubbed = s.replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, '⟨redacted⟩');
  return sanitizeDisplayText(scrubbed).text;
}

/** Resolve the child entry from this module's own package (dist/index.js, dist/cli/*.js or src/kernel/web/*.ts). */
export function defaultChildScript(): string | null {
  for (const rel of ['./transport/gnomon-web.js', '../transport/gnomon-web.js', '../../../dist/transport/gnomon-web.js']) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  return null;
}

function spkiBase64Url(pem: string): string {
  return createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64url');
}

export class WebEndpoint {
  readonly #o: WebEndpointOptions;
  readonly #launcher: (input: TransportLaunchInput) => ChildLaunchPlan;
  readonly #bundle: { dir: string; hash: string };
  readonly #now: () => number;
  readonly access: GuiAccess;
  readonly #nextUlid = monotonicUlidFactory();
  #child: ChildProcess | null = null;
  #plan: ChildLaunchPlan | null = null;
  #listener: net.Server | null = null;
  /** Hand-offs to the current child not yet ACKed, oldest first (Node ACKs in order). */
  #unacked: Array<{ socket: net.Socket; timer: NodeJS.Timeout }> = [];
  /** Bumped by every stop(): a start that began before it must not open the endpoint after it. */
  #stops = 0;
  /** >0 while #onChildExit awaits its exit-log row (a stop() then must cancel the respawn). */
  #exiting = 0;
  #port = 0;
  #dispatcher: KernelDispatcher | null = null;
  #state: 'stopped' | 'starting' | 'listening' = 'stopped';
  #starting: Promise<void> | null = null;
  readonly #ws = new Map<number, WsConn>();
  readonly #restarts: number[] = [];
  #linger: NodeJS.Timeout | null = null;
  #sweep: NodeJS.Timeout | null = null;
  #stopReason: string | null = null;

  static {
    registerSeams('web', {
      create: (opts, seams) => new WebEndpoint(opts, seams),
    });
  }

  /** Production: the platform's transport sandbox and the pinned #gui bundle. */
  static create(opts: WebEndpointOptions): WebEndpoint {
    return new WebEndpoint(opts, {});
  }

  private constructor(opts: WebEndpointOptions, seams: WebEndpointSeams) {
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
    this.access = new GuiAccess(this.#now);
    const platform = opts.platform ?? process.platform;
    this.#launcher = seams.launcher ?? ((input) => transportLaunchPlan(input, platform));
    this.#bundle = seams.bundle ?? { dir: '', hash: GUI_BUNDLE_HASH };
  }

  get listening(): boolean {
    return this.#state === 'listening';
  }

  get port(): number {
    return this.#port;
  }

  get endpointPath(): string {
    return `ws://127.0.0.1:${this.#port}/rpc`;
  }

  /** Argv of the running child (G-WEB-05 falsifier: no token is ever on it). */
  childArgv(): string[] | null {
    return this.#plan ? [this.#plan.command, ...this.#plan.args] : null;
  }

  childEnv(): Record<string, string> | null {
    return this.#plan ? { ...this.#plan.env } : null;
  }

  childPid(): number | null {
    return this.#child?.pid ?? null;
  }

  /** The kernel listener's bound address (G-WEB-01 falsifier: always 127.0.0.1), or null when not listening. */
  listenAddress(): { address: string; port: number } | null {
    const a = this.#listener?.address();
    return a && typeof a !== 'string' ? { address: a.address, port: a.port } : null;
  }

  /** Start the endpoint if it is not listening (the first `gnomon open`). */
  async ensureListening(): Promise<void> {
    if (this.#state === 'listening') return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#spawn().finally(() => (this.#starting = null));
    return this.#starting;
  }

  /**
   * `gnomon open`: mint a launch token for an authenticated HUMAN device
   * connection on the unix socket. The token goes back to that caller only.
   */
  async requestLaunch(asker: Pick<ConnAuthState, 'connId' | 'phase' | 'credential' | 'principalKind' | 'principal' | 'deviceId'>): Promise<LaunchGrant> {
    if (asker.phase !== 'authenticated' || asker.credential !== 'device' || asker.principalKind !== 'human' || !asker.deviceId || !asker.principal) {
      throw new LifecycleRefusal('web-launch-refused', 'a launch token is minted only for an authenticated human device connection (§11.2 rule 2)', { connId: asker.connId });
    }
    await this.ensureListening();
    if (!this.listening) throw new LifecycleRefusal('web-transport-failed', 'the web endpoint stopped while it was starting');
    const binding: LaunchBinding = { deviceId: asker.deviceId, principal: asker.principal, askedBy: asker.connId };
    const { launchToken, expiresAt } = this.access.mint(binding);
    this.#lingerCheck(); // the linger timer re-arms while a launch token is pending
    const kernelPublicKey = spkiBase64Url(this.#o.kernelPublicKeyPem);
    return { port: this.#port, launchToken, expiresAt, kernelPublicKey, bundleHash: this.#bundle.hash, url: `http://127.0.0.1:${this.#port}/#launch=${launchToken}&k=${kernelPublicKey}` };
  }

  status(): Record<string, unknown> {
    return {
      listening: this.listening,
      ...(this.listening ? { port: this.#port, bundleHash: this.#bundle.hash } : {}),
      sandbox: this.#plan?.sandbox ?? null,
      profileHash: this.#plan?.profileHash ?? null,
      connections: this.#ws.size,
      pendingLaunches: this.access.pendingLaunches(),
      guiSessions: { n: this.access.sessions().length, sessions: this.access.sessions().map((s) => ({ connId: s.connId, surface: s.surface, via: s.via, unlock: null })) },
      restarts: this.#restarts.length,
      ...(this.#stopReason ? { lastStop: this.#stopReason } : {}),
    };
  }

  /** `gnomon open --revoke-all`: end every GUI session (their sockets close). */
  revokeAll(): number {
    let n = 0;
    for (const s of this.access.sessions()) if (this.#revoke(s.connId, 'revoke-all')) n++;
    return n;
  }

  /** Stop the endpoint and end its child (daemon exit, linger expiry). */
  async stop(reason: string): Promise<void> {
    if (this.#state === 'stopped' && !this.#child) {
      // already down (restart cap, failed respawn) or between a child's exit and its respawn: never leave a timer
      // behind, and make the pending respawn see the stop (it checks #stops after its exit-log await)
      this.#stops++;
      const wasRestarting = this.#exiting > 0 && this.#stopReason === null;
      this.#stopReason = reason;
      this.#closeListener();
      if (this.#sweep) clearInterval(this.#sweep);
      if (this.#linger) clearTimeout(this.#linger);
      this.#sweep = null;
      this.#linger = null;
      if (wasRestarting) await this.#o.log('socket.web.stop', { reason }).catch(() => undefined);
      return;
    }
    this.#stops++;
    this.#stopReason = reason;
    this.#state = 'stopped';
    if (this.#linger) clearTimeout(this.#linger);
    if (this.#sweep) clearInterval(this.#sweep);
    this.#linger = null;
    this.#sweep = null;
    for (const c of [...this.#ws.values()]) this.#dropConn(c, reason);
    this.#closeListener();
    const child = this.#child;
    this.#child = null;
    if (child) {
      const gone = new Promise<void>((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once('exit', () => r())));
      this.#send({ t: 'shutdown' }, child);
      child.stdin?.end();
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000);
      await gone;
      clearTimeout(kill);
    }
    this.#dropUnacked();
    await this.#o.log('socket.web.stop', { reason }).catch(() => undefined);
  }

  /* ── child supervision ─────────────────────────────────────────────── */

  /**
   * The kernel's listener: 127.0.0.1 (IPv4 literal, never a name, never a wildcard), the OS-chosen port.
   * Each connection is handed to the serving child unread; Node closes the kernel's copy on the child's ACK.
   */
  async #listen(): Promise<number> {
    const server = net.createServer({ pauseOnConnect: true }, (socket) => this.#handOff(socket));
    server.maxConnections = WEB_MAX_PENDING_HANDOFFS; // counts sockets not yet sent (queued behind an unACKed hand-off)
    server.on('error', () => undefined); // after listen: an accept error never takes the daemon down
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
        server.off('error', reject);
        resolve();
      });
    }).catch((err: NodeJS.ErrnoException) => {
      throw new LifecycleRefusal('web-transport-failed', `the kernel cannot listen on 127.0.0.1: ${err.code ?? err.message}`);
    });
    const a = server.address();
    if (a === null || typeof a === 'string' || a.address !== '127.0.0.1') {
      server.close();
      throw new LifecycleRefusal('web-transport-failed', 'the web listener is not bound to 127.0.0.1');
    }
    this.#listener = server;
    return a.port;
  }

  /** Accept-and-forward (A24-1): the kernel never reads the socket; it goes to the serving child or is closed. */
  #handOff(socket: net.Socket): void {
    socket.on('error', () => socket.destroy());
    const child = this.#child;
    if (this.#state !== 'listening' || !child || !child.connected) return void socket.destroy();
    const timer = setTimeout(() => {
      // the child left this hand-off unACKed: it is not serving (or not ours); the restart path follows
      if (this.#child === child) child.kill('SIGKILL');
    }, this.#o.handoffAckMs ?? WEB_HANDOFF_ACK_MS);
    timer.unref();
    const entry = { socket, timer };
    this.#unacked.push(entry);
    // a send that failed will never be ACKed: forget it, so its timer cannot later kill a healthy child (Aegis R2-2)
    const failed = (): void => {
      const i = this.#unacked.indexOf(entry);
      if (i !== -1) this.#unacked.splice(i, 1);
      clearTimeout(timer);
      socket.destroy();
    };
    try {
      child.send(WEB_CONN_MESSAGE, socket, (err) => {
        if (err) failed();
      });
    } catch {
      failed();
    }
  }

  /** The child ACKed the oldest hand-off (Node delivers ACKs in order). */
  #onHandoffAck(): void {
    const h = this.#unacked.shift();
    if (h) clearTimeout(h.timer);
  }

  /** The child is gone: no ACK will come; close every socket still waiting (a queued one still holds its fd here). */
  #dropUnacked(): void {
    for (const h of this.#unacked.splice(0)) {
      clearTimeout(h.timer);
      h.socket.destroy();
    }
  }

  #closeListener(): void {
    const l = this.#listener;
    this.#listener = null;
    l?.close();
  }

  async #spawn(): Promise<void> {
    this.#state = 'starting';
    const scriptPath = this.#o.scriptPath ?? defaultChildScript();
    if (!scriptPath) throw new LifecycleRefusal('web-transport-failed', 'the gnomon-web transport child is not built (dist/transport/gnomon-web.js)');
    const bundleDir = this.#bundle.dir || materializeGuiBundle(this.#o.stateDir ?? this.#o.home);
    const plan = this.#launcher({ scriptPath, bundleDir, protectedDirs: [this.#o.home, ...(this.#o.stateDir ? [this.#o.stateDir] : [])], forbiddenTrees: [path.join(this.#o.home, 'keys')] });
    this.#plan = plan;
    // fd 3 = the IPC channel: it carries only the connected sockets the kernel hands over (WEB_CONN_MESSAGE)
    const child = spawn(plan.command, plan.args, { stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: plan.env, windowsHide: true });
    this.#dropUnacked();
    // The child never speaks on the IPC channel: one that does is not ours (Aegis C1). A handle it attaches is closed.
    const closeHandle = (h: unknown): void => {
      try {
        const x = h as { destroy?: () => void; close?: () => void } | null | undefined;
        if (typeof x?.destroy === 'function') x.destroy();
        else if (typeof x?.close === 'function') x.close();
      } catch {
        /* already closed */
      }
    };
    child.on('message', (_m: unknown, h: unknown) => {
      closeHandle(h);
      child.kill('SIGKILL');
    });
    // 'internalMessage' is undocumented Node: the NODE_* messages (incl. a NODE_HANDLE whose inner message is
    // internal, which never reaches 'message') arrive only here. Guarded: anything but a well-formed
    // NODE_HANDLE_ACK kills the child; the ACK feeds the watchdog. A Node that stopped emitting it would surface
    // as watchdog kills of a healthy child (test/web-endpoint.test.ts asserts ACKs are seen).
    // An UNSOLICITED NODE_HANDLE_ACK (none in flight, or one more than were sent) makes Node's own internalMessage
    // handler — registered before ours — throw ERR_INTERNAL_ASSERTION on its null `_handleQueue`, which would take the
    // daemon down (Aegis round 3, reproduced on Node 26). So this listener goes FIRST (prependListener): on such an
    // ACK it gives Node an empty queue to flush and kills the child. `_handleQueue` is a Node INTERNAL
    // (lib/internal/child_process.js): if a Node release renames it, Array.isArray is false and every ACK — even a
    // solicited one — kills the child, which fails closed and fails the healthy-child canary test loudly.
    child.prependListener('internalMessage', (m: unknown) => {
      if (typeof m !== 'object' || m === null || (m as { cmd?: unknown }).cmd !== 'NODE_HANDLE_ACK') return;
      const internals = child as unknown as { _handleQueue?: unknown };
      if (!Array.isArray(internals._handleQueue) || this.#child !== child || this.#unacked.length === 0) {
        internals._handleQueue = [];
        child.kill('SIGKILL');
      }
    });
    child.on('internalMessage', (m: unknown, h: unknown) => {
      if (child.killed) return closeHandle(h); // already condemned (an unsolicited ACK above)
      if (this.#child === child && h === undefined && typeof m === 'object' && m !== null && (m as { cmd?: unknown }).cmd === 'NODE_HANDLE_ACK') return this.#onHandoffAck();
      closeHandle(h);
      child.kill('SIGKILL');
    });
    this.#child = child;
    let stderrTail = '';
    child.stderr!.on('data', (c: Buffer) => (stderrTail = (stderrTail + c.toString('utf8')).slice(-2048)));
    child.stdin!.on('error', () => undefined);
    const decoder = new NdjsonDecoder(CHANNEL_MAX_RECORD_BYTES);
    let ready: ((r: Extract<ChildRecord, { t: 'ready' }>) => void) | null = null;
    let failed: ((e: Error) => void) | null = null;
    const readyP = new Promise<Extract<ChildRecord, { t: 'ready' }>>((res, rej) => {
      ready = res;
      failed = rej;
    });
    child.stdout!.on('data', (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        // A malformed or shape-invalid record means the child is not ours to trust any more (Aegis C1): kill it (the
        // restart path follows). Its stdout bytes reach kernel logic only through validateChildRecord; its fd-3 bytes
        // are parsed by Node's IPC reader first (unbounded JSON lines: a DoS-only surface, §A.7).
        const r = item.kind === 'frame' ? validateChildRecord(item.value, { maxFrameBytes: WS_MAX_FRAME_BYTES, maxBodyBytes: HTTP_MAX_BODY_BYTES }) : null;
        if (r === null) {
          child.kill('SIGKILL');
          return;
        }
        if (r.t === 'ready') ready?.(r);
        else if (r.t === 'fatal') failed?.(new LifecycleRefusal('web-transport-failed', `transport child: ${r.why.slice(0, 256)}`));
        else if (this.#child === child) {
          try {
            this.#onRecord(r);
          } catch {
            child.kill('SIGKILL');
            return;
          }
        }
      }
    });
    child.on('error', (err) => failed?.(new LifecycleRefusal('web-transport-failed', `cannot spawn the transport child: ${err.message}`)));
    child.once('exit', (code, signal) => {
      failed?.(new LifecycleRefusal('web-transport-failed', `transport child exited before ready (${code ?? signal}) ${stderrTail.slice(-256)}`));
      if (this.#child === child) void this.#onChildExit(code, signal);
    });
    this.#send(
      { t: 'config', bundleDir, pingMs: this.#o.pingMs ?? WS_PING_MS, missedPongs: this.#o.missedPongs ?? WS_MISSED_PONGS, maxFrameBytes: WS_MAX_FRAME_BYTES,
        preAuthMaxFrameBytes: WS_PRE_AUTH_MAX_FRAME_BYTES,
        maxBodyBytes: HTTP_MAX_BODY_BYTES,
        maxSocketBuffer: WS_MAX_SOCKET_BUFFER,
        writeHighWater: WS_WRITE_HIGH_WATER,
        writeLowWater: WS_WRITE_LOW_WATER,
        defaultHeaders: childDefaultHeaders(),
      },
      child,
    );
    const timeout = setTimeout(() => failed?.(new LifecycleRefusal('web-transport-failed', 'transport child did not report ready')), WEB_READY_TIMEOUT_MS);
    let r: Extract<ChildRecord, { t: 'ready' }>;
    // stop() (or another start) may have run while we waited: then this child is no longer ours to open with
    const stops = this.#stops;
    const superseded = (): boolean => this.#stops !== stops;
    try {
      r = await readyP;
    } catch (err) {
      if (superseded()) {
        child.kill('SIGKILL');
        return; // stop() already recorded why; no second socket.web.stop row
      }
      this.#child = null;
      this.#state = 'stopped';
      child.kill('SIGKILL');
      throw err;
    } finally {
      clearTimeout(timeout);
      ready = null;
      failed = null;
    }
    if (superseded()) {
      child.kill('SIGKILL');
      return; // never listen for a child stop() already let go of
    }
    if (this.#child !== child) throw new LifecycleRefusal('web-transport-failed', 'the transport child exited right after ready');
    if (r.bundleHash !== this.#bundle.hash) {
      this.#child = null;
      this.#state = 'stopped';
      child.kill('SIGKILL');
      await this.#o.log('socket.web.bundle.mismatch', { expected: this.#bundle.hash, got: String(r.bundleHash).slice(0, 80) }).catch(() => undefined);
      throw new LifecycleRefusal('web-bundle-mismatch', 'the GUI bundle does not match its pin; the endpoint does not open (§11.2 rule 1a)', { expected: this.#bundle.hash });
    }
    try {
      if (!this.#listener) this.#port = await this.#listen(); // a restarted child keeps the kernel's listener, and so the port
    } catch (err) {
      if (superseded()) {
        child.kill('SIGKILL');
        return;
      }
      this.#child = null;
      this.#state = 'stopped';
      child.kill('SIGKILL');
      throw err;
    }
    if (superseded()) {
      this.#closeListener(); // stop() ran during the listen: the new listener must not outlive it
      child.kill('SIGKILL');
      return;
    }
    const web: WebAuthHook = (conn, params) => this.#webAuth(conn, params);
    this.#dispatcher = this.#o.dispatcher(this.endpointPath, web);
    this.#state = 'listening';
    this.#stopReason = null;
    if (!this.#sweep) {
      this.#sweep = setInterval(() => {
        for (const id of this.access.expired()) this.#revoke(id, 'max-age');
      }, 60_000);
      this.#sweep.unref();
    }
    await this.#o.log('socket.web.listen', { port: this.#port, bundleHash: r.bundleHash, files: r.files, sandbox: plan.sandbox, profileHash: plan.profileHash, pid: child.pid ?? null });
    this.#lingerCheck();
  }

  async #onChildExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    this.#child = null;
    this.#dropUnacked();
    const wasListening = this.#state === 'listening';
    this.#state = 'stopped';
    for (const c of [...this.#ws.values()]) this.#dropConn(c, 'transport-exited');
    const now = this.#now();
    while (this.#restarts.length && now - this.#restarts[0]! > WEB_RESTART_CAP.windowMs) this.#restarts.shift();
    const stops = this.#stops;
    this.#exiting++;
    try {
      await this.#o.log('socket.web.transport.exited', { code, signal, restartsInWindow: this.#restarts.length }).catch(() => undefined);
    } finally {
      this.#exiting--;
    }
    if (this.#stops !== stops) return; // stop() ran during the exit-log write: no respawn
    if (!wasListening) return;
    if (this.#restarts.length >= WEB_RESTART_CAP.max) return this.#down('transport-restart-cap');
    this.#restarts.push(now);
    this.#starting = this.#spawn()
      .catch(() => (this.#stopReason === null ? this.#down('transport-restart-failed') : undefined)) // stop() during the respawn already wrote its row
      .finally(() => (this.#starting = null));
    await this.#starting;
  }

  /** The endpoint is down without a stop() call (restart cap, failed respawn): clear timers, record why. */
  async #down(reason: string): Promise<void> {
    this.#stopReason = reason;
    this.#state = 'stopped';
    this.#closeListener();
    if (this.#linger) clearTimeout(this.#linger);
    if (this.#sweep) clearInterval(this.#sweep);
    this.#linger = null;
    this.#sweep = null;
    await this.#o.log('socket.web.stop', { reason }).catch(() => undefined);
  }

  #send(r: KernelRecord, child: ChildProcess | null = this.#child): void {
    if (child?.stdin && !child.stdin.destroyed) child.stdin.write(encodeRecord(r));
  }

  /** No GUI session ⇒ the linger timer runs (armed once, not reset by unrelated traffic); a session ⇒ it is cleared. */
  #lingerCheck(): void {
    if (this.#state !== 'listening' || this.access.sessions().length > 0) {
      if (this.#linger) clearTimeout(this.#linger);
      this.#linger = null;
      return;
    }
    if (this.#linger) return;
    const ms = this.#o.lingerMs ?? WEB_LINGER_MS;
    this.#linger = setTimeout(() => {
      this.#linger = null;
      if (this.access.sessions().length > 0) return;
      if (this.access.pendingLaunches() > 0) return this.#lingerCheck();
      void this.stop('no-sessions');
    }, ms);
    this.#linger.unref();
    void this.#o.log('socket.web.linger', { ms }).catch(() => undefined);
  }

  /* ── records from the child ────────────────────────────────────────── */

  #onRecord(r: ChildRecord): void {
    switch (r.t) {
      case 'http':
        return this.#onHttp(r);
      case 'upgrade':
        return this.#onUpgrade(r);
      case 'frame':
        return this.#onFrame(r.rid, r.data);
      case 'closed': {
        const c = this.#ws.get(r.rid);
        if (c) this.#dropConn(c, 'closed');
        return;
      }
      case 'pressure': {
        const c = this.#ws.get(r.rid);
        if (c) c.pressure = r.bytes;
        return;
      }
      case 'drain': {
        const c = this.#ws.get(r.rid);
        if (!c) return;
        c.pressure = 0;
        for (const fn of [...c.drainers]) {
          c.drainers.delete(fn);
          fn();
        }
        return;
      }
      default:
        return;
    }
  }

  #logFail(reason: FailReason | 'gui-token', extra: Record<string, unknown> = {}): void {
    void this.#o.log('socket.auth.fail', { reason, transport: 'web', ...extra }).catch(() => undefined);
  }

  #respond(rid: number, status: number, nonStatic: boolean, extra: HeaderMap = {}, body?: Buffer): void {
    this.#send({ t: 'respond', rid, status, headers: { ...securityHeaders(this.#port, nonStatic), ...extra }, ...(body && body.length ? { body: body.toString('base64') } : {}) });
  }

  #onHttp(r: Extract<ChildRecord, { t: 'http' }>): void {
    if (this.#state !== 'listening') return this.#respond(r.rid, 503, true);
    const route = routeHttp(r, this.#port);
    if (route.kind === 'refuse') {
      if (route.fail) this.#logFail(route.fail, { path: String(r.path).slice(0, 64) });
      return this.#respond(r.rid, route.status, route.nonStatic);
    }
    if (route.kind === 'static') {
      return this.#send({ t: 'static', rid: r.rid, file: route.file, headers: { ...securityHeaders(this.#port, false), 'content-type': route.contentType } });
    }
    // the gate an absent Sec-Fetch-Site rests on (rules.ts checkCrossSite tokenGated): every diag/blob route needs it
    const session = this.access.sessionForToken(r.headers['x-gnomon-token']);
    if (!session) {
      this.#logFail('gui-token', { path: route.kind, ...(route.sfsAbsent ? { secFetchSite: 'absent' } : {}) });
      return this.#respond(r.rid, 403, true);
    }
    if (route.kind === 'diag') {
      if (r.bodyOver) return this.#respond(r.rid, 413, true);
      this.#appendGuiLog(session, r.body ? Buffer.from(r.body, 'base64') : Buffer.alloc(0));
      return this.#respond(r.rid, 204, true);
    }
    const bytes = this.#o.blobs?.read(route.sha, session.principal) ?? null;
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== route.sha) return this.#respond(r.rid, 404, true);
    const type = sniffRaster(bytes);
    if (!type) return this.#respond(r.rid, 415, true); // never SVG, never by stored metadata
    return this.#respond(r.rid, 200, true, { 'content-type': type }, bytes);
  }

  #appendGuiLog(session: GuiSession, body: Buffer): void {
    const dir = path.join(this.#o.stateDir ?? this.#o.home, 'logs');
    const file = path.join(dir, 'gui.log');
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (existsSync(file) && statSync(file).size >= GUI_LOG_MAX_BYTES) return; // capped: dropped
      appendFileSync(file, `${JSON.stringify({ at: new Date(this.#now()).toISOString(), connId: session.connId, surface: session.surface, text: redactDiagText(body.toString('utf8')) })}\n`, { mode: 0o600 });
      chmodSync(file, 0o600);
    } catch {
      /* diagnostics never fail the request */
    }
  }

  #onUpgrade(r: Extract<ChildRecord, { t: 'upgrade' }>): void {
    if (this.#state !== 'listening' || !this.#dispatcher) return this.#respond(r.rid, 503, true);
    const v = decideUpgrade(r, this.#port);
    if (!v.ok) {
      if (v.fail) this.#logFail(v.fail, { path: String(r.path).slice(0, 64), upgrade: true });
      return this.#respond(r.rid, v.status, true, v.headers ?? {});
    }
    const max = this.#o.maxConnections ?? WEB_MAX_CONNECTIONS;
    // count only live (non-closing) connections; a closing one is already on its way out (reviewer / Aegis C5)
    const live = [...this.#ws.values()].filter((c) => !c.closing && !c.closed);
    if (live.length >= max) {
      const oldest = live.filter((c) => c.state.phase !== 'authenticated').sort((a, b) => a.openedAt - b.openedAt)[0];
      if (!oldest) return this.#respond(r.rid, 503, true); // never evict an authenticated GUI connection
      this.#closeConn(oldest, WS_CLOSE_TRY_LATER);
    }
    this.#send({ t: 'accept', rid: r.rid });
    this.#openConn(r.rid);
  }

  #openConn(rid: number): void {
    const dispatcher = this.#dispatcher!;
    const connId = mintId('conn', this.#nextUlid());
    const c: WsConn = {
      rid,
      connId,
      ctx: null as unknown as ConnectionContext,
      state: { phase: 'pre-hello', frames: 0 },
      closing: false,
      closed: false,
      openedAt: this.#now(),
      limiter: new AttemptLimiter(),
      chain: Promise.resolve(),
      queued: 0,
      pressure: 0,
      drainers: new Set(),
      afterReply: [],
      deadline: null,
      release: null,
    };
    c.ctx = {
      connId,
      close: () => this.#closeConn(c, WS_CLOSE_POLICY),
      authenticated: () => {
        c.state.phase = 'authenticated';
        this.#send({ t: 'limit', rid, maxFrameBytes: WS_MAX_FRAME_BYTES }); // lift the child's pre-auth 16 KiB cap
        if (c.deadline) clearTimeout(c.deadline);
        c.deadline = null;
      },
      notify: (method, params) => {
        if (c.closing || c.closed) return false;
        this.#sendText(c, encodeFrame(notificationFrame(method, params))); // throws over the outbound cap
        return true;
      },
      get closed() {
        return c.closing || c.closed;
      },
      // per connection: the bytes the child reports unsent on THIS WebSocket (pressure/drain records)
      writableLength: () => c.pressure,
      writeHighWater: WS_WRITE_HIGH_WATER,
      writeLowWater: WS_WRITE_LOW_WATER,
      onDrain: (fn) => {
        c.drainers.add(fn);
        return () => void c.drainers.delete(fn);
      },
      afterReply: (fn) => void c.afterReply.push(fn),
    };
    this.#ws.set(rid, c);
    c.release = this.#o.holdIdle?.() ?? null;
    dispatcher.onConnect(c.ctx);
    c.deadline = setTimeout(() => {
      if (c.state.phase !== 'authenticated') this.#closeConn(c, WS_CLOSE_POLICY); // rule 7: hello + auth within 5 s
    }, this.#o.authDeadlineMs ?? WEB_AUTH_DEADLINE_MS);
    c.deadline.unref();
  }

  #sendText(c: WsConn, ndjsonLine: Buffer): void {
    this.#send({ t: 'send', rid: c.rid, data: ndjsonLine.subarray(0, ndjsonLine.length - 1).toString('base64') });
  }

  #sendResponse(c: WsConn, frame: RpcResponseFrame): void {
    let bytes: Buffer;
    try {
      bytes = encodeFrame(frame);
    } catch {
      bytes = encodeFrame(errorFrame(frame.id, refusalWith('ENGINE', 'response-too-large', 'response exceeds the frame limit')));
    }
    this.#sendText(c, bytes);
  }

  #closeConn(c: WsConn, code: number): void {
    if (c.closing || c.closed) return;
    c.closing = true;
    this.#send({ t: 'close', rid: c.rid, code });
  }

  /** The connection is gone (child report, transport exit, stop): end its session and its dispatcher state. */
  #dropConn(c: WsConn, reason: string): void {
    if (c.closed) return;
    c.closed = true;
    this.#ws.delete(c.rid);
    if (c.deadline) clearTimeout(c.deadline);
    this.#dispatcher?.onDisconnect(c.ctx);
    c.release?.();
    if (this.access.end(c.connId)) {
      void this.#o.log('socket.gui.session.ended', { reason }, { connId: c.connId }).catch(() => undefined);
    }
    this.#lingerCheck();
  }

  /** Revoke a GUI session (theft, revoke-all, 12 h): the session ends now and its socket closes. */
  #revoke(connId: string, reason: string): boolean {
    const had = this.access.end(connId);
    const c = [...this.#ws.values()].find((x) => x.connId === connId);
    if (had) void this.#o.log('socket.gui.session.ended', { reason }, { connId }).catch(() => undefined);
    if (c) this.#closeConn(c, WS_CLOSE_POLICY);
    this.#lingerCheck();
    return had;
  }

  #onFrame(rid: number, data: string): void {
    const c = this.#ws.get(rid);
    if (!c || c.closing || c.closed) return;
    const bytes = Buffer.from(data, 'base64');
    const pre = c.state.phase !== 'authenticated';
    if (pre && bytes.length > PRE_AUTH_MAX_FRAME_BYTES) return this.#closeConn(c, WS_CLOSE_POLICY); // defence in depth: the child enforces it first (1009)
    const item = decodeLine(bytes);
    if (item === null || item.kind !== 'frame') {
      if (pre) return this.#closeConn(c, WS_CLOSE_POLICY); // rule 7: before auth, only hello then auth
      const reason = item === null ? 'malformed-json' : item.kind === 'malformed' ? `malformed-${item.reason}` : 'malformed-json';
      return this.#enqueue(c, async () => this.#sendResponse(c, errorFrame(null, refusalWith('BAD_REQUEST', reason, 'unparseable frame (one JSON-RPC object per text frame)'))));
    }
    const parsed = parseRequest(item.value);
    if (!parsed.ok) {
      if (pre) return this.#closeConn(c, WS_CLOSE_POLICY);
      return this.#enqueue(c, async () => this.#sendResponse(c, errorFrame(parsed.id, parsed)));
    }
    const req = parsed.frame;
    if (pre) {
      // rule 7: the first frame is hello and the second auth; anything else closes, undispatched
      const want = c.state.frames === 0 ? 'hello' : c.state.frames === 1 ? 'auth' : null;
      c.state.frames++;
      if (req.method !== want) return this.#closeConn(c, WS_CLOSE_POLICY);
      if (want === 'hello') c.state.phase = 'pre-auth';
      // rule 8. Defence in depth: today every failed auth closes the connection and a second auth on an
      // authenticated one is refused and closes too, so at most one attempt per connection can arrive.
      if (want === 'auth' && !c.limiter.attempt(this.#now())) return this.#closeConn(c, WS_CLOSE_POLICY);
    } else if (req.method === 'auth' && !c.limiter.attempt(this.#now())) return this.#closeConn(c, WS_CLOSE_POLICY);
    const isNotification = !Object.hasOwn(req, 'id');
    this.#enqueue(c, async () => {
      if (c.closing || c.closed) return;
      let resp: RpcResponseFrame;
      let closeAfter = false;
      try {
        resp = resultFrame(req.id ?? null, await this.#dispatcher!.handle(req, c.ctx));
      } catch (err) {
        if (err instanceof RpcRefusal) {
          resp = errorFrame(req.id ?? null, { refusal: err.refusal, message: err.message });
          closeAfter = err.closeAfter;
        } else resp = errorFrame(req.id ?? null, refusalWith('ENGINE', 'internal', 'internal error'));
      }
      const after = c.afterReply;
      c.afterReply = [];
      if (closeAfter) {
        this.#sendResponse(c, resp);
        return this.#closeConn(c, WS_CLOSE_POLICY);
      }
      if (c.closing || c.closed) return;
      if (!isNotification) this.#sendResponse(c, resp);
      for (const fn of after) fn();
    });
  }

  #enqueue(c: WsConn, job: () => Promise<void>): void {
    if (c.queued >= WEB_MAX_IN_FLIGHT) return this.#closeConn(c, WS_CLOSE_POLICY); // flow control: fail closed
    c.queued++;
    c.chain = c.chain
      .then(job)
      .catch(() => undefined)
      .finally(() => void c.queued--);
  }

  /* ── auth {launchToken} / {reconnect} ──────────────────────────────── */

  #webAuth(conn: ConnAuthState, params: Record<string, unknown>): AuthOutcome {
    const fail = authFail;
    const keys = Object.keys(params);
    const surface = conn.client?.surface ?? null;
    if (surface !== 'browser' && surface !== 'wrapper') return fail('auth-params', 'a GUI connection names hello client.surface browser or wrapper (§4.9)');
    if ('reconnect' in params) {
      if (keys.length !== 1 || params.reconnect !== true) return fail('auth-params', 'Reconnect is exactly {reconnect: true}');
      // §11.2 rule 2a: a presence prompt (approval.request kind permission, requestedBy p:<ns>/kernel) naming this connId,
      // the surface and the count of open GUI sessions; on presence {guiToken, principal, connId, kernelPublicKey}.
      // The prompt is the signed helper's (#identity M1.3, requestPresence): until then Reconnect is refused.
      return fail('web-auth-not-implemented', 'Reconnect needs the presence prompt of the signed helper (#identity M1.3); run `gnomon open`', {
        code: 'UNSUPPORTED',
        data: { milestone: 'M1.3', cause: 'presence-unavailable' },
        preRows: [{ kind: 'socket.auth.reconnect.requested', payload: { surface, openGuiSessions: this.access.sessions().length } }],
      });
    }
    if (keys.length !== 1 || typeof params.launchToken !== 'string') return fail('auth-params', 'launch auth is exactly {launchToken}');
    const x = this.access.exchange(params.launchToken, conn.connId);
    switch (x.kind) {
      case 'unknown':
        return fail('unknown-token', 'not a launch token this kernel issued');
      case 'expired':
        return fail('token-expired', 'the launch token has expired (60 s, single use); run `gnomon open` again');
      case 'replay':
        // after the TTL: a history / session-restore replay — log only, no revoke, no card (S29-K7)
        return fail('replayed-transcript', 'this launch token was already used', { replay: true, logPayload: { consumedBy: x.consumedBy, surface } });
      case 'theft':
        // inside the TTL: theft (D55) — revoke the session that consumed it. The fresh-presence gate-class card is M1.6.
        this.#revoke(x.consumedBy, 'theft');
        return fail('replayed-transcript', 'this launch token was already used', { replay: true, logKind: 'socket.auth.theft', logPayload: { revokedConnId: x.consumedBy, surface } });
      case 'fresh': {
        const { guiToken } = this.access.issue({ connId: conn.connId, deviceId: x.binding.deviceId, principal: x.binding.principal, surface, via: 'launch' });
        conn.phase = 'authenticated';
        conn.credential = 'gui';
        conn.principal = x.binding.principal;
        conn.principalKind = 'human';
        conn.deviceId = x.binding.deviceId;
        conn.via = 'launch';
        return {
          ok: true,
          credential: 'gui',
          principal: x.binding.principal,
          principalKind: 'human',
          deviceId: x.binding.deviceId,
          via: 'launch',
          guiToken,
          commit: () => this.#lingerCheck(),
          abort: () => void this.access.end(conn.connId),
        };
      }
    }
  }
}

/**
 * #warplined-client — the thin typed client of the solo daemon. This is what
 * the CLI uses for `warpline daemon call …`, and what the platform router /
 * judgment console re-points to in the console lane (NOT this lane — no
 * platform code is touched here; the client is the seam they will use).
 *
 * Transport mirror of server.ts: NDJSON frames over the unix socket; requests
 * carry the bearer token; responses correlate by id. A refused frame rejects
 * with DaemonRpcError carrying the machine-readable code. Results are the
 * engine shapes VERBATIM (G3) — the client deserializes, it never reshapes.
 *
 * In-process engine calls remain the CLI default; the daemon path is opt-in
 * (`warpline daemon call`, or `daemonAvailable()` for auto-detection).
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import type { AdmitNativeResult, ForkNativeResult, ProposeNativeResult, ResolveNativeResult } from '../fabric/native.js';
import type { KnotPayload } from '../fabric/knot-payload.js';
import type { GradeReport } from '../fabric/grade.js';
import type { ShadowVerdictRow } from '../fabric/shadow.js';
import type { StakeResult, StakeRecoverResult } from '../fabric/stake.js';
import type { BackupResult } from '../fabric/backup.js';
import type { CreateClaimInput } from '../fabric/claim.js';
import { RPC_SCHEMA, type RpcErrorCode, type RpcResponse } from './protocol.js';
import type { Refusal } from '../fabric/refusal.js';
import { socketPathOf } from './lifecycle.js';

/**
 * A daemon-side refusal (AUTH / FORBIDDEN / …) or engine error, typed. Carries
 * the wire frame's `refusal:v1` verbatim (SP2) — a caller branches on
 * code/gate/retriable enums, never on the human `message`.
 */
export class DaemonRpcError extends Error {
  constructor(
    public code: RpcErrorCode,
    message: string,
    public refusal?: Refusal,
  ) {
    super(message);
    this.name = 'DaemonRpcError';
  }
}

/** Is a daemon socket present for this fabric? (The auto-detect hook for
 * native verbs — presence of the socket, not liveness; connect() confirms.) */
export function daemonAvailable(root: string): boolean {
  try {
    return fs.statSync(socketPathOf(root)).isSocket();
  } catch {
    return false;
  }
}

export interface DaemonStatus {
  schemaVersion: typeof RPC_SCHEMA;
  pid: number;
  startedAt: string;
  uptimeMs: number;
  root: string;
  principal: string;
  kind: 'human' | 'agent';
  /** 'read' = console-class token capped at READ_ONLY_VERBS; null = full. */
  scope: 'read' | null;
  selvage: string | null;
  verbs: string[];
  /** PW-6 state-aware self-description (additive) — the relocated F4 carrier. */
  cycle?: Array<{ verb: string; stage: string; principal: 'agent' | 'human' }>;
  position?: { scratchPresent: boolean; scratchIsPickId: boolean; proposalSealed: boolean; behindSelvage: boolean };
  nextLegalVerbs?: string[];
  /** daemon verb → MCP tool name (`knot.show` → `warpline_knot_show`). */
  toolMap?: Record<string, string>;
  untrustedContent?: string;
}

export interface ShadowAdmitOverDaemon {
  shadow: true;
  row: ShadowVerdictRow;
  result: unknown; // AdmitResult (git-era shape) — verbatim engine return
}

export interface ConnectOptions {
  /** explicit socket path (default: `.warpline/daemon.sock` under `root`). */
  socketPath?: string;
  /** per-call timeout in ms (default 120_000 — admits lift real trees). */
  timeoutMs?: number;
}

/**
 * One connection to `warplined`. Frames are correlated by id, so calls may be
 * issued concurrently on a single client; the server answers a connection's
 * frames in order.
 */
export class DaemonClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buffer = '';

  private constructor(
    private readonly sock: net.Socket,
    private readonly token: string,
    private readonly timeoutMs: number,
  ) {
    sock.on('data', (chunk) => this.onData(chunk));
    sock.on('error', (err) => this.failAll(err instanceof Error ? err : new Error(String(err))));
    sock.on('close', () => this.failAll(new Error('warpline: daemon connection closed')));
  }

  /** Connect to the daemon serving `root` (or an explicit socketPath). */
  static connect(root: string, token: string, opts: ConnectOptions = {}): Promise<DaemonClient> {
    const sp = opts.socketPath ?? socketPathOf(root);
    return new Promise((resolve, reject) => {
      const sock = net.connect(sp);
      sock.once('connect', () => resolve(new DaemonClient(sock, token, opts.timeoutMs ?? 120_000)));
      sock.once('error', (err) =>
        reject(new Error(`warpline: cannot reach the daemon at ${sp} — is it running? (\`warpline daemon start\`): ${err.message}`)),
      );
    });
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let resp: RpcResponse;
      try {
        resp = JSON.parse(line) as RpcResponse;
      } catch {
        continue; // torn frame — the per-call timeout surfaces the failure
      }
      const id = typeof resp.id === 'number' ? resp.id : NaN;
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (resp.ok) entry.resolve(resp.result);
      else entry.reject(new DaemonRpcError(resp.error.code, resp.error.message, resp.error.refusal));
    }
  }

  private failAll(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  /** Raw verb call — the typed helpers below are thin sugar over this. */
  call<T = unknown>(verb: string, params?: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`warpline: daemon call ${verb} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.sock.write(
        JSON.stringify({ rpc: RPC_SCHEMA, id, verb, token: this.token, ...(params ? { params } : {}) }) + '\n',
      );
    });
  }

  close(): void {
    this.sock.destroy();
    this.failAll(new Error('warpline: daemon client closed'));
  }

  /* ── typed verb surface (G3: engine shapes verbatim) ──────────────────────── */

  status(): Promise<DaemonStatus> {
    return this.call('status');
  }

  refsList(): Promise<{ refs: Record<string, string>; heads: string[] }> {
    return this.call('refs.list');
  }

  fork(params: { into?: string } = {}): Promise<ForkNativeResult> {
    return this.call('fork', params);
  }

  propose(params: {
    worktree?: string;
    intent: string;
    claim?: Omit<CreateClaimInput, 'agentId' | 'intent'> & { intent?: string };
    now?: string;
    sessionKey?: string;
  }): Promise<ProposeNativeResult> {
    return this.call('propose', params);
  }

  admit(params: {
    worktree?: string;
    intent?: string;
    claim?: string;
    acceptBreach?: boolean;
    acceptRisk?: boolean;
    now?: string;
    noRestore?: boolean;
  } = {}): Promise<AdmitNativeResult> {
    return this.call('admit', params);
  }

  admitShadow(params: { worktree?: string; claim?: string } = {}): Promise<ShadowAdmitOverDaemon> {
    return this.call('admit', { ...params, shadow: true });
  }

  knotShow(selector: string): Promise<KnotPayload> {
    return this.call('knot.show', { selector });
  }

  resolve(params: { worktree?: string; agentId: string; reason: string; now?: string }): Promise<ResolveNativeResult> {
    return this.call('resolve', params);
  }

  stake(params: { selector?: string } = {}): Promise<StakeResult> {
    return this.call('stake', params);
  }

  stakeRecover(commit: string): Promise<StakeRecoverResult> {
    return this.call('stake.recover', { commit });
  }

  gradeReport(params: { window?: number } = {}): Promise<GradeReport> {
    return this.call('grade.report', params);
  }

  shadowTail(n = 20): Promise<{ rows: ShadowVerdictRow[]; total: number }> {
    return this.call('shadow.tail', { n });
  }

  /** Snapshot the daemon's fabric into `dest` (human-class only — Aegis §2.2). */
  backup(dest: string): Promise<BackupResult> {
    return this.call('backup', { dest });
  }
}

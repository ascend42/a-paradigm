/**
 * @symbol #gnomon-voice
 *
 * The voice client's kernel link (V2e): the kernel SPAWNS the voice client and hands it one end of a socketpair as
 * an inherited fd (`gnomon-voice run --fd 3`). That connection is ALREADY AUTHENTICATED as the voice principal
 * `p:<ns>/voice` — no hello, no auth, no key on this side. Over it the client speaks the kernel's normal
 * `gnomon-rpc:v1` framing (packages/gnomon/src/kernel/socket/framing.ts + rpc.ts, mirrored here, never imported):
 *
 *   one JSON object per `\n`-terminated line (max 4 MiB);
 *   request  {jsonrpc:'2.0', rpc:'gnomon-rpc:v1', id, method, params?}
 *   result   {jsonrpc:'2.0', rpc, id, result} | error {jsonrpc:'2.0', rpc, id, error:{code:number, message, data:Refusal}}
 *   event    {jsonrpc:'2.0', rpc, method:'event', params:{subscription, row?, cursor?, end?:{reason}}}  (log.read follow)
 *
 * Verbs used: status, log.append, log.read{follow, scope:{hsid}}, session.send, session.stop{interrupt}. A
 * subscription is bound SYNCHRONOUSLY when its reply frame is decoded (event frames in the same chunk follow it).
 * No cancel verb exists (§4.9): a subscription ends with the connection or the kernel's attachment change.
 */
import * as net from 'node:net';
import type { Duplex } from 'node:stream';
import type { AppendResult, KernelLink, KernelRow, VoiceAttachment } from './types.js';

export const GNOMON_RPC_V1 = 'gnomon-rpc:v1' as const;
export const MAX_RPC_FRAME = 4 * 1024 * 1024;
export const CLIENT_NAME = '@a-company/gnomon-voice' as const;

/** A kernel refusal as the client sees it (toRefusal in voice-client.ts reads code / refusal.data.reason). */
export class RpcError extends Error {
  constructor(readonly method: string, readonly code: string, message: string, readonly refusal?: { code?: string; data?: { reason?: string } }, readonly rpcCode?: number) {
    super(message);
    this.name = 'RpcError';
  }
  get reason(): string | undefined {
    return this.refusal?.data?.reason;
  }
}

/** Byte-based NDJSON splitter (multi-byte UTF-8 safe); an oversize line is dropped up to its newline. */
export class LineDecoder {
  #pending: Buffer[] = [];
  #len = 0;
  #discarding = false;
  constructor(readonly max = MAX_RPC_FRAME) {}
  push(chunk: Buffer, out: (v: Record<string, unknown>) => void): void {
    let off = 0;
    while (off < chunk.length) {
      const nl = chunk.indexOf(0x0a, off);
      if (nl === -1) {
        const rest = chunk.subarray(off);
        if (this.#discarding) return;
        if (this.#len + rest.length > this.max) {
          this.#discarding = true;
          this.#pending = [];
          this.#len = 0;
        } else {
          this.#pending.push(Buffer.from(rest));
          this.#len += rest.length;
        }
        return;
      }
      const seg = chunk.subarray(off, nl);
      off = nl + 1;
      if (this.#discarding || this.#len + seg.length > this.max) {
        this.#discarding = false;
        this.#pending = [];
        this.#len = 0;
        continue;
      }
      const line = this.#len ? Buffer.concat([...this.#pending, seg]) : seg;
      this.#pending = [];
      this.#len = 0;
      let v: unknown;
      try {
        v = JSON.parse(line.toString('utf8'));
      } catch {
        continue;
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) out(v as Record<string, unknown>);
    }
  }
}

export interface SubscriptionHandlers {
  row(r: unknown): void;
  end?(e: { reason: string }): void;
  /** the subscribe reply ({subscription, head, …}), delivered BEFORE any of its event frames */
  ready?(result: Record<string, unknown>): void;
}

/** The structural client the link needs (FdRpc implements it; tests may pass a stub). */
export interface GnomonClientLike {
  call(method: string, params: unknown): Promise<unknown>;
  subscribe(params: Record<string, unknown>, h: SubscriptionHandlers): Promise<unknown>;
  close(): Promise<void>;
  onClose?(cb: (reason: string) => void): void;
}

interface Pending {
  method: string;
  resolve(v: unknown): void;
  reject(e: Error): void;
  onResult?: (r: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** A small gnomon-rpc:v1 client over an already-authenticated duplex (the inherited socketpair fd). */
export class FdRpc implements GnomonClientLike {
  readonly #sock: Duplex;
  readonly #pending = new Map<number, Pending>();
  readonly #subs = new Map<string, SubscriptionHandlers>();
  readonly #closeCbs: Array<(reason: string) => void> = [];
  readonly #timeoutMs: number;
  #nextId = 1;
  #closed: string | undefined;

  constructor(sock: Duplex, o: { timeoutMs?: number } = {}) {
    this.#sock = sock;
    this.#timeoutMs = o.timeoutMs ?? 15_000;
    const dec = new LineDecoder();
    sock.on('data', (c: Buffer) => dec.push(c, (v) => this.#onFrame(v)));
    sock.on('end', () => this.#onClose('end'));
    sock.on('close', () => this.#onClose('closed'));
    sock.on('error', (e) => this.#onClose(`error: ${e.message}`));
  }

  /** Wrap an inherited fd (the kernel's end of the socketpair is already authenticated). */
  static fromFd(fd: number, o: { timeoutMs?: number } = {}): FdRpc {
    if (!Number.isInteger(fd) || fd < 3) throw new RangeError(`#gnomon-voice: --fd must be an inherited descriptor >= 3 (got ${fd})`);
    return new FdRpc(new net.Socket({ fd, readable: true, writable: true }), o);
  }

  get closed(): boolean {
    return this.#closed !== undefined;
  }

  onClose(cb: (reason: string) => void): void {
    if (this.#closed !== undefined) queueMicrotask(() => cb(this.#closed!));
    else this.#closeCbs.push(cb);
  }

  call(method: string, params?: unknown, onResult?: (r: unknown) => void): Promise<unknown> {
    if (this.#closed !== undefined || this.#sock.destroyed || !this.#sock.writable) return Promise.reject(new RpcError(method, 'CLOSED', `the kernel link is closed (${this.#closed ?? 'not writable'})`));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const p: Pending = { method, resolve, reject, ...(onResult ? { onResult } : {}) };
      p.timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(Object.assign(new RpcError(method, 'ETIMEDOUT', `${method} timed out`), { code: 'ETIMEDOUT' }));
      }, this.#timeoutMs);
      this.#pending.set(id, p);
      const frame = { jsonrpc: '2.0', rpc: GNOMON_RPC_V1, id, method, ...(params !== undefined ? { params } : {}) };
      this.#sock.write(`${JSON.stringify(frame)}\n`);
    });
  }

  /** log.read{follow:true}: rows through h.row in seq order; h.end on drop / connection loss. */
  subscribe(params: Record<string, unknown>, h: SubscriptionHandlers): Promise<unknown> {
    return this.call('log.read', { ...params, follow: true }, (r) => {
      const sub = (r as { subscription?: unknown })?.subscription;
      if (typeof sub === 'string') this.#subs.set(sub, h);
      if (r && typeof r === 'object') h.ready?.(r as Record<string, unknown>);
    });
  }

  close(): Promise<void> {
    if (this.#sock.destroyed) return Promise.resolve();
    return new Promise((res) => {
      this.#sock.once('close', () => res());
      this.#sock.destroy();
    });
  }

  #onFrame(v: Record<string, unknown>): void {
    if (typeof v.id === 'number' && ('result' in v || 'error' in v)) {
      const p = this.#pending.get(v.id);
      if (!p) return;
      this.#pending.delete(v.id);
      clearTimeout(p.timer);
      if ('error' in v && v.error) {
        const e = v.error as { code?: unknown; message?: unknown; data?: { code?: string; data?: { reason?: string } } };
        const name = typeof e.data?.code === 'string' ? e.data.code : 'ERROR';
        p.reject(new RpcError(p.method, name, typeof e.message === 'string' ? e.message : `${p.method} refused`, e.data, typeof e.code === 'number' ? e.code : undefined));
        return;
      }
      p.onResult?.(v.result); // bind the subscription before any following event frame is dispatched
      p.resolve(v.result);
      return;
    }
    if (v.method === 'event' && v.params && typeof v.params === 'object') {
      const ev = v.params as { subscription?: unknown; row?: unknown; end?: { reason?: unknown } };
      const h = typeof ev.subscription === 'string' ? this.#subs.get(ev.subscription) : undefined;
      if (!h) return;
      if (ev.end) {
        this.#subs.delete(ev.subscription as string);
        h.end?.({ reason: typeof ev.end.reason === 'string' ? ev.end.reason : 'ended' });
      } else if (ev.row !== undefined) h.row(ev.row);
    }
  }

  #onClose(reason: string): void {
    if (this.#closed !== undefined) return;
    this.#closed = reason;
    for (const p of this.#pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RpcError(p.method, 'CLOSED', `the kernel link closed (${reason})`));
    }
    this.#pending.clear();
    for (const h of this.#subs.values()) h.end?.({ reason: 'closed' });
    this.#subs.clear();
    for (const cb of this.#closeCbs.splice(0)) cb(reason);
  }
}

/** ns of `p:<ns>/voice` (speakerIds are `spk:<ns>/<name>`). */
export function nsOf(principalId: string): string {
  const m = /^p:([0-9a-z]{8})\/voice$/.exec(principalId);
  if (!m) throw new TypeError(`#gnomon-voice: ${principalId} is not a voice principal (p:<ns>/voice)`);
  return m[1]!;
}

/** status.voice.stopSpeakingSeq (T-2026-10-19-026: the human's ⏹ Stop speaking count), or null when absent. */
export function stopSpeakingSeqFromStatus(status: unknown): number | null {
  const n = (status as { voice?: { stopSpeakingSeq?: unknown } } | undefined)?.voice?.stopSpeakingSeq;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** The principal this connection is authenticated as: `status.voice.principal` (V2e; the kernel reports it to the voice connection only). */
export function principalFromStatus(status: unknown): string | undefined {
  const p = (status as { voice?: { principal?: unknown } } | undefined)?.voice?.principal;
  return typeof p === 'string' ? p : undefined;
}

/**
 * The attachment from `status.voice`. V2a shape: {attached: boolean, hsid, ceiling, voiceSessionId, since, idleAt, …}
 * (the ceiling becomes `mode`); V1 shape: {attached: {voiceSessionId, hsid, mode} | null}.
 */
export function attachmentFromStatus(status: unknown): VoiceAttachment | null {
  const v = (status as { voice?: Record<string, unknown> })?.voice;
  if (v && typeof v.attached === 'boolean') {
    if (!v.attached || typeof v.hsid !== 'string' || typeof v.voiceSessionId !== 'string' || typeof v.ceiling !== 'string') return null;
    return { hsid: v.hsid, voiceSessionId: v.voiceSessionId, mode: v.ceiling };
  }
  const a = v?.attached as Partial<VoiceAttachment> | null | undefined;
  if (!a || typeof a.hsid !== 'string' || typeof a.voiceSessionId !== 'string' || typeof a.mode !== 'string') return null;
  return { hsid: a.hsid, voiceSessionId: a.voiceSessionId, mode: a.mode };
}

/** A projected row → KernelRow (full view: the event; a stub carries only kind + hsid and no payload). */
export function kernelRowOf(r: unknown): KernelRow | undefined {
  const x = r as { seq?: unknown; kind?: unknown; session?: unknown; principal?: unknown; payload?: unknown; event?: Record<string, unknown> } | undefined;
  const e = (x?.event && typeof x.event === 'object' ? x.event : x) as typeof x;
  if (!e || typeof e.kind !== 'string') return undefined;
  const principal = (e as { principal?: unknown }).principal;
  return { seq: Number(e.seq ?? x?.seq ?? 0), kind: e.kind, ...(typeof e.session === 'string' ? { session: e.session } : {}), ...(typeof principal === 'string' ? { principal } : {}), payload: (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown> };
}

export class GnomonKernelLink implements KernelLink {
  constructor(readonly client: GnomonClientLike) {}

  /** The link over the inherited, already-authenticated socketpair fd. */
  static fromFd(fd: number, o: { timeoutMs?: number } = {}): GnomonKernelLink {
    return new GnomonKernelLink(FdRpc.fromFd(fd, o));
  }

  status(): Promise<unknown> {
    return this.client.call('status', {});
  }
  #stopSpeakingSeq: number | null = null;
  #micWanted: boolean | null = null;
  async attachment(): Promise<VoiceAttachment | null> {
    const st = await this.status();
    this.#stopSpeakingSeq = stopSpeakingSeqFromStatus(st);
    const mw = (st as { voice?: { micWanted?: unknown } } | undefined)?.voice?.micWanted;
    this.#micWanted = typeof mw === 'boolean' ? mw : null;
    return attachmentFromStatus(st);
  }
  stopSpeakingSeq(): number | null {
    return this.#stopSpeakingSeq;
  }
  /** TD-2026-10-21-514: status.voice.micWanted (the kernel-held mic state), or null when never reported. */
  micWanted(): boolean | null {
    return this.#micWanted;
  }
  async append(kind: string, payload: Record<string, unknown>): Promise<AppendResult> {
    const r = (await this.client.call('log.append', { kind, payload })) as Record<string, unknown> | null;
    // the kernel's verdict on a voice.turn.user (voice drops fix): kept when well-typed, never trusted beyond display
    return {
      seq: Number(r?.seq ?? 0),
      ...(typeof r?.forwardable === 'boolean' ? { forwardable: r.forwardable } : {}),
      ...(typeof r?.refused === 'string' ? { refused: r.refused } : {}),
      ...(typeof r?.refusedCause === 'string' ? { refusedCause: r.refusedCause } : {}),
    };
  }
  send(hsid: string, text: string): Promise<unknown> {
    return this.client.call('session.send', { hsid, content: [{ text }] });
  }
  interrupt(hsid: string): Promise<unknown> {
    return this.client.call('session.stop', { hsid, interrupt: true });
  }
  async follow(hsid: string, row: (r: KernelRow) => void, end: (reason: string) => void): Promise<() => void> {
    let live = true;
    // the voice connection has no hello, so no journal.cursor feature: follow starts at the log's beginning.
    // Backlog rows (seq <= the reply's head) are history, never spoken; only voice.turn.agent rows are needed.
    let head = Number.POSITIVE_INFINITY;
    await this.client.subscribe({ scope: { hsid }, kinds: ['voice.turn.agent'] }, {
      ready: (res) => {
        head = typeof res.head === 'number' ? res.head : 0;
      },
      row: (r) => {
        const k = kernelRowOf(r);
        if (live && k && k.seq > head) row(k);
      },
      end: (e) => {
        if (live) end(e.reason);
      },
    });
    // no cancel verb exists (§4.9): a subscription ends with its connection or the kernel's attachment change
    return () => {
      live = false;
    };
  }
  /** The link closed (fd EOF / error): the client exits. */
  onClose(cb: (reason: string) => void): void {
    this.client.onClose?.(cb);
  }
  close(): Promise<void> {
    return this.client.close();
  }
}

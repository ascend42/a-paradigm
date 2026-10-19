/**
 * @symbol #gui
 *
 * #gui in-bundle `gnomon-rpc:v1` client over the loopback WebSocket (spec
 * §4.9, §11.2 rules 2/2a/7, §12.8). MINIMAL ON PURPOSE and built only on the
 * published `@a-company/gnomon-contracts` surface (hello shape, the
 * authServerPreimage, refusal:v1, clientApiId): M1.10 SLICE 2 SWAPS IT for
 * the published TypeScript client (`#client-ts`, M1.12) so the GUI uses no
 * privilege a community client lacks (§11.2 last paragraph).
 *
 * The transport is injected (a browser WebSocket in the page, a raw RFC 6455
 * socket in the endpoint integration test). Order is the endpoint's rule 7:
 * `hello` first, `auth` second; `serverSig` is verified between them and on a
 * failure NOTHING more is sent. Each hello carries a fresh `clientNonce`
 * (T-2026-10-18-016) that the result must echo and serverSig must cover.
 * The hello offers `journal.cursor` (P8-D98): every log.read resume sends the
 * `{logId, seq}` cursor (`followLog`), and a `cursor-epoch` refusal clears
 * the store and re-reads from the start.
 */
import { CLIENT_API_ID, type HelloResult } from '@a-company/gnomon-contracts';
import { newClientNonce, verifyServerSig, type SigVerdict } from './server-sig.js';
import type { GuiStore } from './store.js';

export const RPC = 'gnomon-rpc:v1' as const;
export const GUI_CLIENT = Object.freeze({ name: 'gnomon-gui', version: '8.0.0-m1.10.1' });
/** Hello features the GUI implements: the `{logId, seq}` log.read cursor (P8-D98, §5) and resumed sessions (session.resume, §2.4 rule 11). */
export const GUI_FEATURES: readonly string[] = Object.freeze(['journal.cursor', 'session.resume']);

/** The message channel the client needs: one JSON text per message. */
export interface Transport {
  send(text: string): void;
  /** False once the channel can no longer send (WebSocket readyState !== OPEN); absent ⇒ assumed open. */
  isOpen?(): boolean;
  close(): void;
  onMessage: ((text: string) => void) | null;
  onClose: ((code: number) => void) | null;
}

/** A WebSocket (browser) as a Transport; resolves once open. */
export function webSocketTransport(url: string, Ctor: typeof WebSocket = WebSocket): Promise<Transport> {
  return new Promise((resolve, reject) => {
    const ws = new Ctor(url);
    const t: Transport = {
      send: (s) => ws.send(s),
      isOpen: () => ws.readyState === 1, // WebSocket.OPEN
      close: () => ws.close(1000),
      onMessage: null,
      onClose: null,
    };
    ws.onmessage = (e: MessageEvent) => t.onMessage?.(typeof e.data === 'string' ? e.data : '');
    ws.onclose = (e: CloseEvent) => t.onClose?.(e.code);
    ws.onopen = () => resolve(t);
    ws.onerror = () => reject(new Error('websocket error'));
  });
}

/** A refusal as the GUI shows it: CODE, reason, plain words, next steps (instrument-readout voice). */
export interface ShownRefusal {
  code: string;
  reason: string | null;
  message: string;
  next: string[];
  data: Record<string, unknown> | null;
}

export class RpcError extends Error {
  constructor(readonly refusal: ShownRefusal) {
    super(`${refusal.code}${refusal.reason ? ` ${refusal.reason}` : ''}: ${refusal.message}`);
    this.name = 'RpcError';
  }
}

/** Read a JSON-RPC error frame's refusal:v1 (error.data) into the shown shape; unknown shapes stay opaque, never dropped. */
export function refusalFromError(error: unknown): ShownRefusal {
  const e = (error && typeof error === 'object' ? error : {}) as { code?: unknown; message?: unknown; data?: unknown };
  const r = (e.data && typeof e.data === 'object' ? e.data : {}) as { code?: unknown; data?: unknown; next?: unknown };
  const data = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null;
  const next = Array.isArray(r.next)
    ? r.next.map((n) => {
        const x = (n && typeof n === 'object' ? n : {}) as { verb?: unknown; principal?: unknown };
        return `${String(x.verb ?? '?')}${x.principal ? ` (${String(x.principal)})` : ''}`;
      })
    : [];
  return {
    code: typeof r.code === 'string' ? r.code : `RPC ${String(e.code ?? '?')}`,
    reason: data && typeof data.reason === 'string' ? data.reason : null,
    message: typeof e.message === 'string' ? e.message : 'refused',
    next,
    data,
  };
}

export type AuthForm = { launchToken: string } | { reconnect: true } | { resumeToken: string };

export interface Session {
  hello: HelloResult;
  guiToken: string;
  principal: string;
  connId: string;
  /** The kernel's clientApiId differs from the one this bundle was built against (additive drift; shown, not fatal). */
  clientApiDrift: boolean;
}

export type ConnectOutcome =
  | { ok: true; session: Session }
  | { ok: false; stage: 'hello' | 'server-sig' | 'auth' | 'transport'; refusal?: ShownRefusal; sig?: SigVerdict; message: string };

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> | null };

/** Default per-call timeout (a call the kernel never answers fails visibly instead of hanging the page). */
export const CALL_TIMEOUT_MS = 30_000;

export class GnomonClient {
  readonly #t: Transport;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #closed = false;
  readonly #listeners = new Set<(method: string, params: unknown) => void>();
  readonly #closeListeners = new Set<(code: number) => void>();
  readonly #protocolListeners = new Set<(r: ShownRefusal) => void>();
  readonly #timeoutMs: number;

  constructor(transport: Transport, opts: { callTimeoutMs?: number } = {}) {
    this.#timeoutMs = opts.callTimeoutMs ?? CALL_TIMEOUT_MS;
    this.#t = transport;
    transport.onMessage = (text) => this.#onMessage(text);
    transport.onClose = (code) => {
      this.#closed = true;
      for (const p of this.#pending.values()) {
        if (p.timer) clearTimeout(p.timer);
        // sent, never answered: the kernel may or may not have acted on it — distinct from CLOSED (never sent) (T-2026-10-19-009 item 6)
        p.reject(new RpcError({ code: 'DELIVERY_UNKNOWN', reason: 'delivery-unknown', message: `the connection closed (${code}) before the answer: it is unknown whether the kernel acted on it`, next: [], data: null }));
      }
      this.#pending.clear();
      for (const fn of this.#closeListeners) fn(code);
    };
  }

  get closed(): boolean {
    return this.#closed;
  }

  onNotification(fn: (method: string, params: unknown) => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  /** An error frame the kernel could not tie to a request (`id: null`: an unparseable frame, BAD_REQUEST) — never dropped silently. */
  onProtocolError(fn: (r: ShownRefusal) => void): () => void {
    this.#protocolListeners.add(fn);
    return () => void this.#protocolListeners.delete(fn);
  }

  onClose(fn: (code: number) => void): () => void {
    this.#closeListeners.add(fn);
    return () => void this.#closeListeners.delete(fn);
  }

  #onMessage(text: string): void {
    let f: Record<string, unknown>;
    try {
      f = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof f.method === 'string' && !('id' in f)) {
      for (const fn of this.#listeners) fn(f.method, f.params);
      return;
    }
    const id = typeof f.id === 'number' ? f.id : null;
    if (id === null) {
      if ('error' in f) for (const fn of this.#protocolListeners) fn(refusalFromError(f.error));
      return;
    }
    const p = this.#pending.get(id);
    if (!p) return;
    this.#pending.delete(id);
    if (p.timer) clearTimeout(p.timer);
    if ('error' in f) p.reject(new RpcError(refusalFromError(f.error)));
    else p.resolve(f.result);
  }

  /** One call; rejects with RpcError carrying the refusal. */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    // provably never sent (closed, or the socket left OPEN) ⇒ CLOSED; DELIVERY_UNKNOWN is only for a sent frame
    if (this.#closed || this.#t.isOpen?.() === false) return Promise.reject(new RpcError({ code: 'CLOSED', reason: 'connection-closed', message: 'the connection is closed', next: [], data: null }));
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer =
        this.#timeoutMs > 0
          ? setTimeout(() => {
              if (!this.#pending.delete(id)) return;
              reject(new RpcError({ code: 'TIMEOUT', reason: 'call-timeout', message: `${method}: no answer within ${this.#timeoutMs} ms`, next: [], data: null }));
            }, this.#timeoutMs)
          : null;
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.#t.send(JSON.stringify({ jsonrpc: '2.0', rpc: RPC, id, method, ...(params !== undefined ? { params } : {}) }));
    });
  }

  close(): void {
    this.#t.close();
  }

  /**
   * hello → verify serverSig (WebCrypto, against `verifyKey`) → auth. On a
   * signature failure the socket is closed and nothing else is sent.
   */
  async connect(o: { surface: 'browser' | 'wrapper'; endpointPath: string; verifyKey: string; auth: AuthForm; subtle: SubtleCrypto | undefined; rng?: (b: Uint8Array) => Uint8Array }): Promise<ConnectOutcome> {
    let hello: HelloResult;
    let clientNonce: string;
    try {
      // inside the try (Aegis r2): an engine without getRandomValues fails the hello stage visibly, never throws out of connect
      clientNonce = newClientNonce(o.rng);
      hello = await this.call<HelloResult>('hello', { clientApis: [RPC], features: [...GUI_FEATURES], clientNonce, client: { ...GUI_CLIENT, surface: o.surface } });
    } catch (err) {
      return { ok: false, stage: 'hello', ...(err instanceof RpcError ? { refusal: err.refusal } : {}), message: err instanceof Error ? err.message : 'hello failed' };
    }
    const sig = await verifyServerSig(o.subtle, o.verifyKey, hello, o.endpointPath, clientNonce);
    if (!sig.ok) {
      this.close();
      return { ok: false, stage: 'server-sig', sig, message: sig.message };
    }
    try {
      const r = await this.call<{ guiToken: string; principal: string; connId: string }>('auth', o.auth);
      return { ok: true, session: { hello, guiToken: r.guiToken, principal: r.principal, connId: r.connId, clientApiDrift: hello.clientApiId !== CLIENT_API_ID } };
    } catch (err) {
      return { ok: false, stage: 'auth', ...(err instanceof RpcError ? { refusal: err.refusal } : {}), message: err instanceof Error ? err.message : 'auth failed' };
    }
  }
}

/**
 * The two credentialed HTTP routes (§11.2 rule 5, P8-D89b): POST with the GUI
 * token in `X-Gnomon-Token` and `referrerPolicy: 'same-origin'` (under the
 * page's no-referrer policy a POST would carry `Origin: null` and fail the
 * origin lock). `fetchFn` is injected so tests can assert the exact init.
 */
export function gnomonPost(fetchFn: typeof fetch, path: '/diag' | `/blob/${string}`, guiToken: string, body?: string): Promise<Response> {
  return fetchFn(path, { method: 'POST', referrerPolicy: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'X-Gnomon-Token': guiToken }, ...(body !== undefined ? { body } : {}) });
}

/** The kernel refused a resume because the cursor names another log (a quarantine replaced it, or another kernel). */
export function isCursorEpoch(err: unknown): boolean {
  return err instanceof RpcError && err.refusal.code === 'BAD_REQUEST' && err.refusal.reason === 'cursor-epoch';
}

/**
 * Backlog pages then the follow subscription, every resume carrying the store's `{logId, seq}` cursor
 * (journal.cursor). On `cursor-epoch` the store is cleared and the read starts over from the head of the
 * current log, once; a second refusal surfaces to the caller.
 */
export async function followLog(c: Pick<GnomonClient, 'call'>, store: GuiStore): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      for (;;) {
        const since = store.cursor();
        const page = await c.call<{ rows: unknown[]; next: number; caughtUp: boolean; logId: string }>('log.read', { ...(since ? { since } : {}), limit: 1000 });
        store.adopt(page.logId);
        store.apply(page.rows);
        store.advance(page.next);
        if (page.caughtUp) break;
      }
      const since = store.cursor();
      const sub = await c.call<{ logId: string }>('log.read', { ...(since ? { since } : {}), follow: true });
      store.adopt(sub.logId);
      return;
    } catch (err) {
      if (attempt > 0 || !isCursorEpoch(err)) throw err;
      store.reset();
    }
  }
}

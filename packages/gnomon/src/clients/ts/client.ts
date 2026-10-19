/**
 * @symbol #gnomon-ts-client
 *
 * #gnomon-ts-client — the published TypeScript client for `gnomon-rpc:v1`
 * (spec §4.9, §5, §12.8; M1.12 slice 2). It is built ONLY on
 * `@a-company/gnomon-contracts` and `node:*` — never on kernel code — so it is
 * exactly what a community client could write from the package alone (the
 * test/m112-clients fence proves the import set).
 *
 *   hello → send a fresh 32-byte `clientNonce`; refuse a result that does not
 *           echo it (`client-nonce-mismatch`); verify serverSig against the
 *           PINNED kernel key (from the root-signed registry, never from the
 *           server) over the server nonce, THIS client's nonce and the
 *           endpoint path THIS client derived, BEFORE any credential is sent
 *           (T-2026-10-18-016: a recorded genuine hello replayed from a
 *           squatted endpoint fails);
 *   auth  → a device key (`gnomon:auth:v1`) or a read token's proof of
 *           possession (`gnomon:auth-token:v1`, {tokenId, sig}); the token seed
 *           never leaves this process;
 *   call  → typed by `ClientMethodParams` / `ClientMethodResults` (12 verbs +
 *           2 relays); a refusal rejects with the contracts `RefusedError`;
 *   subscribe → `log.read{follow}`: rows arrive in seq order through a callback,
 *           and a final `end` (dropped / internal / closed) is reported, never
 *           swallowed. Resume points are the `{logId, seq}` cursor
 *           (`journal.cursor`, offered by default, P8-D98): `since` takes it,
 *           `cursor()` and `end.cursor` hand it back; a cursor from another
 *           log is refused `cursor-epoch` — re-read from the start.
 *
 * Logging goes through an injected `ClientLogPort` (Paradigm-logger shaped;
 * the kernel package ships zero dependencies, G-SEC-01). No platform branches.
 */
import * as net from 'node:net';
import { createHash, createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify, type KeyObject } from 'node:crypto';
import {
  CLIENT_NONCE_BYTES,
  GNOMON_RPC_V1,
  RefusedError,
  authClientPreimage,
  authServerPreimage,
  authTokenPreimage,
  isRefusalV1,
  refuse,
  validateHelloResult,
  type ClientMethod,
  type ClientMethodParams,
  type ClientMethodResults,
  type HelloParams,
  type HelloResult,
  type LogReadCursor,
  type LogReadParams,
  type LogRow,
  type LogSubscribeResult,
  type Refusal,
} from '@a-company/gnomon-contracts';

/** A Paradigm-logger-shaped port (`log.component('#gnomon-ts-client').info(…)`); omitted ⇒ silent. */
export interface ClientLogPort {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
}

export const CLIENT_NAME = '@a-company/gnomon/clients/ts' as const;
/** The frame cap the kernel enforces (§4.9); the client refuses to buffer past it. */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const READ_TOKEN = /^grt:v1:([0-9A-HJKMNP-TV-Z]{26})\.([A-Za-z0-9_-]{43})$/;

/** The kernel key a client trusts: from the root-signed registry, never from the server. */
export interface KernelKeyPin {
  keyId: string;
  publicKeyPem: string;
}

export type ClientCredential =
  | { kind: 'device'; principalId: string; deviceId: string; privateKeyPem: string }
  | { kind: 'read-token'; token: string };

function closedRefusal(): RefusedError {
  return new RefusedError(refuse({ code: 'ENGINE', data: { reason: 'connection-closed' } }), 'connection closed');
}

export class ClientAuthError extends Error {
  constructor(
    readonly reason: 'bad-hello' | 'hello-not-offered' | 'client-nonce-mismatch' | 'server-key-mismatch' | 'bad-server-sig' | 'unverified-server' | 'bad-credential',
    message: string,
  ) {
    super(`gnomon-client: ${message}`);
    this.name = 'ClientAuthError';
  }
}

/** keyId of an Ed25519 public key: `gkey:v1:` + sha256(spki PEM without trailing newlines) — the registry's rule (§3.1). */
export function ed25519KeyIdOf(publicKeyPem: string): string {
  return `gkey:v1:${createHash('sha256').update(publicKeyPem.replace(/\n+$/, ''), 'utf8').digest('hex')}`;
}

/** A fresh hello clientNonce: 32 random bytes, base64url (T-2026-10-18-016). */
export function newClientNonce(): string {
  return randomBytes(CLIENT_NONCE_BYTES).toString('base64url');
}

/**
 * Throws ClientAuthError unless `hello` echoes `clientNonce` (the value THIS
 * client sent) and is signed by the pinned kernel key over it, this endpoint
 * path and the negotiated hello. The signature is checked over the sent
 * nonce, never the echoed field.
 */
export function verifyHelloSignature(hello: HelloResult, endpointPath: string, pin: KernelKeyPin, clientNonce: string): void {
  if (validateHelloResult(hello).length) throw new ClientAuthError('bad-hello', 'hello result does not validate');
  if (hello.clientNonce !== clientNonce) throw new ClientAuthError('client-nonce-mismatch', 'hello does not echo this connection\'s clientNonce: a replayed hello (§4.9)');
  if (ed25519KeyIdOf(pin.publicKeyPem) !== pin.keyId) throw new ClientAuthError('server-key-mismatch', 'pinned PEM does not hash to the pinned keyId');
  if (hello.serverKeyId !== pin.keyId) throw new ClientAuthError('server-key-mismatch', `server key ${hello.serverKeyId} is not the registered kernel key`);
  const pre = Buffer.from(authServerPreimage(hello.nonce, clientNonce, endpointPath, { clientApi: hello.clientApi, features: hello.features }), 'utf8');
  let ok = false;
  try {
    ok = edVerify(null, pre, createPublicKey(pin.publicKeyPem), Buffer.from(hello.serverSig, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) throw new ClientAuthError('bad-server-sig', 'serverSig does not verify: not the kernel (§4.9)');
}

function readTokenKey(token: string): { tokenId: string; key: KeyObject } {
  const m = READ_TOKEN.exec(token);
  if (!m) throw new ClientAuthError('bad-credential', 'not a read token (grt:v1:<id>.<seed>)');
  const seed = Buffer.from(m[2]!, 'base64url');
  if (seed.length !== 32) throw new ClientAuthError('bad-credential', 'not a read token (seed)');
  return { tokenId: `rtk:${m[1]}`, key: createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' }) };
}

function deviceKey(pem: string): KeyObject {
  let k: KeyObject;
  try {
    k = createPrivateKey(pem);
  } catch {
    throw new ClientAuthError('bad-credential', 'the device key is not a PKCS#8 PEM private key');
  }
  if (k.asymmetricKeyType !== 'ed25519') throw new ClientAuthError('bad-credential', 'the device key is not Ed25519');
  return k;
}

/** A refusal frame's error, as the contracts `RefusedError` (an invalid refusal is reported as ENGINE, never trusted). */
function refusedFrom(error: { code?: unknown; message?: unknown; data?: unknown }): RefusedError {
  const data = isRefusalV1(error.data) ? (error.data as Refusal) : refuse({ code: 'ENGINE', data: { reason: 'invalid-refusal', rpcCode: error.code as number } });
  return new RefusedError(data, typeof error.message === 'string' ? error.message : 'refused');
}

/** Hello features this client implements: the `{logId, seq}` log.read cursor (P8-D98, §5) and resumed sessions (session.resume, §2.4 rule 11). */
export const CLIENT_FEATURES: readonly string[] = Object.freeze(['journal.cursor', 'session.resume']);

/** True when a refusal says the cursor names another log: drop local state and re-read from the start (no `since`). */
export function isCursorEpoch(err: unknown): boolean {
  const r = (err as { refusal?: { code?: unknown; data?: { reason?: unknown } } } | undefined)?.refusal;
  return r?.code === 'BAD_REQUEST' && r.data?.reason === 'cursor-epoch';
}

type SubEntry = { h: SubscriptionHandlers; logId?: string; seq: number };
const cursorOf = (e: SubEntry): LogReadCursor | undefined => (e.logId !== undefined && e.seq > 0 ? { logId: e.logId, seq: e.seq } : undefined);

export interface SubscriptionHandlers {
  /** One row, in seq order. */
  row(row: LogRow): void;
  /** The subscription ended: `dropped` (lagged past the cap: re-subscribe from `since`), `internal`, or `closed` (connection gone). */
  end?(end: { reason: string; since?: number; lag?: number; cursor?: LogReadCursor }): void;
}

export interface Subscription extends LogSubscribeResult {
  /** The `{logId, seq}` of the highest row delivered so far (the resume `since` after a drop); undefined before any row. */
  readonly cursor: () => LogReadCursor | undefined;
}

export interface ConnectOptions {
  socketPath: string;
  /** The endpoint path the client derived itself (defaults to socketPath); bound into every signature. */
  endpointPath?: string;
  client: HelloParams['client'];
  clientApis?: string[];
  features?: readonly string[];
  /** Required before any credential is sent. */
  kernelKey?: KernelKeyPin;
  credential?: ClientCredential;
  log?: ClientLogPort;
  timeoutMs?: number;
}

type Frame = Record<string, unknown>;

/** One authenticated (or hello-only) connection to a Gnomon kernel. */
export class GnomonClient {
  readonly #sock: net.Socket;
  readonly #log?: ClientLogPort;
  readonly #timeoutMs: number;
  readonly #pending = new Map<number, (f: Frame) => void>();
  readonly #subs = new Map<string, SubEntry>();
  #buf: Buffer = Buffer.alloc(0);
  #nextId = 1;
  #closed = false;
  hello!: HelloResult;
  serverVerified = false;
  principal?: string;
  connId?: string;
  expiresAt?: string;

  private constructor(sock: net.Socket, log: ClientLogPort | undefined, timeoutMs: number) {
    this.#sock = sock;
    this.#log = log;
    this.#timeoutMs = timeoutMs;
    sock.on('data', (chunk: Buffer) => this.#onData(chunk));
    sock.on('error', () => undefined);
    sock.on('close', () => this.#onClose());
  }

  /** hello → serverSig verified against the pin → auth (if a credential is given). Never sends a credential to an unverified server. */
  static async connect(o: ConnectOptions): Promise<GnomonClient> {
    // credential shape is checked before any connection exists
    const cred = o.credential as { kind?: unknown } | undefined;
    if (cred !== undefined && cred.kind !== 'read-token' && cred.kind !== 'device') throw new ClientAuthError('bad-credential', 'a credential is {kind: device} or {kind: read-token}');
    const token = o.credential?.kind === 'read-token' ? readTokenKey(o.credential.token) : undefined;
    const device = o.credential?.kind === 'device' ? { ...o.credential, key: deviceKey(o.credential.privateKeyPem) } : undefined;
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect(o.socketPath);
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
    const c = new GnomonClient(sock, o.log, o.timeoutMs ?? 5000);
    try {
      const offeredApis = o.clientApis ?? [GNOMON_RPC_V1];
      const offeredFeatures = o.features ?? CLIENT_FEATURES;
      const clientNonce = newClientNonce();
      c.hello = (await c.#request('hello', { clientApis: offeredApis, features: offeredFeatures, clientNonce, client: o.client })) as HelloResult;
      if (validateHelloResult(c.hello).length) throw new ClientAuthError('bad-hello', 'hello result does not validate');
      if (!offeredApis.includes(c.hello.clientApi) || !Array.isArray(c.hello.features) || c.hello.features.some((f) => !offeredFeatures.includes(f))) {
        throw new ClientAuthError('hello-not-offered', 'hello chose a clientApi or feature this client did not offer');
      }
      // pinned or not, the hello must echo THIS connection's nonce (T-2026-10-18-016)
      if (c.hello.clientNonce !== clientNonce) throw new ClientAuthError('client-nonce-mismatch', 'hello does not echo this connection\'s clientNonce: a replayed hello (§4.9)');
      const endpointPath = o.endpointPath ?? o.socketPath;
      if (o.kernelKey) {
        verifyHelloSignature(c.hello, endpointPath, o.kernelKey, clientNonce);
        c.serverVerified = true;
      }
      if (o.credential && !c.serverVerified) throw new ClientAuthError('unverified-server', 'refusing to authenticate to an unverified server (no pinned kernel key)');
      const negotiated = { clientApi: c.hello.clientApi, features: c.hello.features };
      if (token) {
        const pre = authTokenPreimage(c.hello.nonce, c.hello.serverKeyId, token.tokenId, endpointPath, negotiated);
        const r = (await c.#request('auth', { tokenId: token.tokenId, sig: edSign(null, Buffer.from(pre, 'utf8'), token.key).toString('base64') })) as Frame;
        c.principal = r.principal as string;
        c.connId = r.connId as string;
        c.expiresAt = r.expiresAt as string;
      } else if (device) {
        const pre = authClientPreimage(c.hello.nonce, c.hello.serverKeyId, device.principalId, device.deviceId, endpointPath, negotiated);
        const r = (await c.#request('auth', { principal: device.principalId, deviceId: device.deviceId, sig: edSign(null, Buffer.from(pre, 'utf8'), device.key).toString('base64') })) as Frame;
        c.principal = r.principal as string;
        c.connId = r.connId as string;
      }
      c.#log?.info('connected', { clientApi: c.hello.clientApi, serverVerified: c.serverVerified, ...(c.connId ? { connId: c.connId } : {}) });
      return c;
    } catch (err) {
      c.#log?.warn('connect refused', { error: err instanceof Error ? err.name : 'unknown' });
      await c.close();
      throw err;
    }
  }

  get closed(): boolean {
    return this.#closed;
  }

  /** A typed call on the client surface (12 verbs + 2 relays). Rejects with RefusedError on a refusal. */
  call<M extends ClientMethod>(method: M, params: ClientMethodParams[M]): Promise<ClientMethodResults[M]> {
    return this.#request(method, params) as Promise<ClientMethodResults[M]>;
  }

  /** Any method by name (conformance: unknown verbs, malformed params). */
  callRaw(method: string, params?: unknown): Promise<unknown> {
    return this.#request(method, params);
  }

  /** `log.read{follow:true}`: backlog then live rows, in seq order, through `h.row`. */
  async subscribe(params: Omit<LogReadParams, 'follow'>, h: SubscriptionHandlers): Promise<Subscription> {
    const entry: SubEntry = { h, ...(params.since ? { logId: params.since.logId } : {}), seq: params.since?.seq ?? 0 };
    // bound SYNCHRONOUSLY when the reply frame is read: the kernel writes the reply first, and
    // event frames in the same chunk are dispatched before an awaiting caller resumes
    let r: LogSubscribeResult;
    try {
      r = (await this.#request('log.read', { ...params, follow: true }, (result) => {
        const sub = (result as { subscription?: unknown }).subscription;
        const logId = (result as { logId?: unknown }).logId;
        if (typeof logId === 'string') entry.logId = logId;
        if (typeof sub === 'string') this.#subs.set(sub, entry);
      })) as LogSubscribeResult;
    } catch (err) {
      // no cancel verb exists (§4.9: a subscription ends with its connection): a subscribe that timed out may
      // still be live server-side, so the only way to end it is to close the connection
      if ((err as { code?: string }).code === 'ETIMEDOUT') await this.close();
      throw err;
    }
    return Object.assign(r, { cursor: () => cursorOf(entry) });
  }

  close(): Promise<void> {
    if (this.#sock.destroyed) return Promise.resolve();
    return new Promise((res) => {
      this.#sock.once('close', () => res());
      this.#sock.destroy();
    });
  }

  #request(method: string, params: unknown, onResult?: (result: unknown) => void): Promise<unknown> {
    // provably never sent ⇒ connection-closed; delivery-unknown is only for a frame that was written (#onClose)
    const sock = this.#sock;
    if (this.#closed || sock.destroyed || !sock.writable || sock.writableEnded) return Promise.reject(closedRefusal());
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.#pending.delete(id);
        // delivery-AMBIGUOUS, like delivery-unknown (Reviewer B8): the frame may have reached the kernel and been
        // acted on, and bytes still buffered keep flushing after this timer, so "not yet flushed" never proves
        // "not sent". The caller re-reads state before retrying a non-idempotent verb.
        reject(Object.assign(new Error(`gnomon-client: ${method} timed out`), { code: 'ETIMEDOUT' }));
      }, this.#timeoutMs);
      this.#pending.set(id, (f) => {
        clearTimeout(t);
        if (f.local instanceof RefusedError) reject(f.local); // client-local (delivery-unknown): not a wire refusal, never re-validated as one
        else if (f.error && typeof f.error === 'object') reject(refusedFrom(f.error as Frame));
        else {
          onResult?.(f.result);
          resolve(f.result);
        }
      });
      this.#sock.write(`${JSON.stringify({ jsonrpc: '2.0', rpc: GNOMON_RPC_V1, id, method, ...(params === undefined ? {} : { params }) })}\n`, (err) => {
        // the stream refused the bytes outright (destroyed / ended under us): not sent ⇒ connection-closed
        const code = (err as NodeJS.ErrnoException | null | undefined)?.code;
        if (code !== 'ERR_STREAM_DESTROYED' && code !== 'ERR_STREAM_WRITE_AFTER_END') return;
        if (!this.#pending.delete(id)) return;
        clearTimeout(t);
        reject(closedRefusal());
      });
    });
  }

  #onData(chunk: Buffer): void {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    let nl: number;
    while ((nl = this.#buf.indexOf(0x0a)) >= 0) {
      if (nl > MAX_FRAME_BYTES) {
        // checked BEFORE parsing: an oversize frame is never handed to JSON.parse
        this.#log?.warn('oversize frame: closing', { bytes: nl });
        this.#buf = Buffer.alloc(0);
        this.#sock.destroy();
        return;
      }
      const line = this.#buf.subarray(0, nl).toString('utf8');
      this.#buf = this.#buf.subarray(nl + 1);
      let f: unknown;
      try {
        f = JSON.parse(line);
      } catch {
        this.#log?.warn('malformed frame dropped');
        continue;
      }
      if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
      this.#onFrame(f as Frame);
    }
    if (this.#buf.length > MAX_FRAME_BYTES) {
      this.#log?.warn('oversize frame: closing', { bytes: this.#buf.length });
      this.#sock.destroy();
    }
  }

  #onFrame(f: Frame): void {
    if (!Object.hasOwn(f, 'id')) {
      if (f.method === 'event') this.#deliver((f.params ?? {}) as Frame);
      return;
    }
    const cb = this.#pending.get(f.id as number);
    if (cb) {
      this.#pending.delete(f.id as number);
      cb(f);
    }
  }

  #deliver(p: Frame): void {
    const id = p.subscription as string;
    const s = this.#subs.get(id);
    if (!s) return; // not ours (or already ended)
    if (p.end && typeof p.end === 'object') {
      this.#subs.delete(id);
      const end = p.end as { reason: string; since?: number; cursor?: LogReadCursor };
      s.h.end?.({ ...end, ...(end.cursor === undefined && cursorOf(s) ? { cursor: cursorOf(s) } : {}) });
      return;
    }
    const row = p.row as LogRow;
    if (row && typeof row.seq === 'number') {
      s.seq = row.seq;
      const c = p.cursor as { logId?: unknown } | undefined;
      if (c && typeof c.logId === 'string') s.logId = c.logId;
      s.h.row(row);
    }
  }

  #onClose(): void {
    this.#closed = true;
    // every pending request was written and got no reply: delivery unknown, never success or a plain close (T-2026-10-19-009 item 6)
    // handed over as a RefusedError: refusedFrom's wire validation would turn the client-local reason into invalid-refusal
    const unknown = { local: new RefusedError(refuse({ code: 'ENGINE', data: { reason: 'delivery-unknown' } }), 'connection dropped before the reply: delivery unknown') };
    for (const cb of this.#pending.values()) cb(unknown);
    this.#pending.clear();
    for (const s of this.#subs.values()) {
      const cursor = cursorOf(s);
      s.h.end?.({ reason: 'closed', since: s.seq, ...(cursor ? { cursor } : {}) });
    }
    this.#subs.clear();
  }
}

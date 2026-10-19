/**
 * @symbol #socket
 *
 * #socket (spec §4.9) — the kernel-side `gnomon-rpc:v1` client helpers for the
 * CLI and tests: a one-shot `rpcCall`, and (M1.4) `connectGnomon` — hello,
 * serverSig verified against the registry's kernel key BEFORE auth, then
 * device-key auth, or (M1.4 slice 3, P8-D89a) a read token's proof of
 * possession {tokenId, sig} — the seed never leaves this process, and the
 * proof is sent only after the server is verified. The published TS client is
 * M1.12.
 *
 * T-2026-10-18-016: every hello carries a fresh 32-byte `clientNonce`; the
 * client refuses (`client-nonce-mismatch`) a hello that does not echo it and
 * verifies serverSig over the nonce IT sent, so a genuine hello recorded on
 * another connection and replayed from a squatted socket never reaches auth.
 */
import * as net from 'node:net';
import { randomBytes } from 'node:crypto';
import { encodeFrame, NdjsonDecoder } from './framing.js';
import {
  CLIENT_API_ID,
  CLIENT_NONCE_BYTES,
  authTokenMessage,
  JSON_RPC_CODES,
  RefusedError,
  refuse,
  validateHelloResult,
  type HelloParams,
  type HelloResult,
} from '@a-company/gnomon-contracts';
import { KeyRing, type Signer } from '../log/signer.js';
import { parseReadToken } from '../identity/read-token.js';
import { clientAuthMessage, serverSigMessage } from './auth.js';
import { requestFrame, type RpcErrorFrame, type RpcId, type RpcResponseFrame } from './rpc.js';

export interface CallOptions {
  timeoutMs?: number;
}

/** Send one request and resolve with its response frame. Rejects on connect failure or timeout. */
export function rpcCall(socketPath: string, method: string, params?: unknown, opts: CallOptions = {}): Promise<RpcResponseFrame> {
  const id = 1;
  return new Promise((resolve, reject) => {
    const decoder = new NdjsonDecoder();
    const conn = net.connect(socketPath);
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(Object.assign(new Error(`gnomon-rpc: ${method} timed out`), { code: 'ETIMEDOUT' }))),
      opts.timeoutMs ?? 5000,
    );
    conn.on('connect', () => conn.write(encodeFrame(requestFrame(id, method, params))));
    conn.on('data', (chunk: Buffer) => {
      for (const item of decoder.push(chunk)) {
        if (item.kind === 'frame' && item.value.id === id) finish(() => resolve(item.value as unknown as RpcResponseFrame));
      }
    });
    conn.on('error', (err) => finish(() => reject(err)));
    conn.on('close', () => finish(() => reject(Object.assign(new Error('gnomon-rpc: connection closed'), { code: 'ECONNRESET' }))));
  });
}

/* ── M1.4: the authenticating client helper ─────────────────────────────── */

export interface ServerKeyPin {
  keyId: string;
  publicKeyPem: string;
}

export interface DeviceCredential {
  principalId: string;
  deviceId: string;
  /** A `device`-class signer (identity/device-key.ts loadDeviceKey). */
  signer: Signer;
}

export class ServerAuthError extends Error {
  constructor(
    readonly reason: 'server-key-mismatch' | 'bad-server-sig' | 'bad-hello' | 'unverified-server' | 'hello-not-offered' | 'client-nonce-mismatch',
    message: string,
  ) {
    super(`gnomon-rpc: ${message}`);
    this.name = 'ServerAuthError';
  }
}

/** A fresh hello clientNonce: 32 random bytes, base64url (T-2026-10-18-016). */
export function newClientNonce(): string {
  return randomBytes(CLIENT_NONCE_BYTES).toString('base64url');
}

/**
 * Verify a hello result's serverSig against the kernel key the CLIENT trusts
 * (from the root-signed registry, never from the server), over the endpoint
 * path the client itself derived. A relay or impostor that cannot sign as the
 * kernel fails here, before `auth` is sent (§4.9). `clientNonce` is the value
 * THIS client sent in hello (T-2026-10-18-016): the echo must equal it and the
 * signature is checked over it, never over the echoed field.
 */
export function verifyServerHello(hello: HelloResult, endpointPath: string, pin: ServerKeyPin, clientNonce: string): void {
  if (validateHelloResult(hello).length) throw new ServerAuthError('bad-hello', 'hello result does not validate');
  if (hello.clientNonce !== clientNonce) throw new ServerAuthError('client-nonce-mismatch', 'hello does not echo this connection\'s clientNonce: a replayed hello (§4.9)');
  if (hello.serverKeyId !== pin.keyId) throw new ServerAuthError('server-key-mismatch', `server key ${hello.serverKeyId} is not the registered kernel key`);
  const ring = new KeyRing();
  if (ring.addEd25519(pin.publicKeyPem) !== pin.keyId) throw new ServerAuthError('server-key-mismatch', 'pinned PEM does not hash to the pinned keyId');
  if (ring.verify(pin.keyId, 'authServer', serverSigMessage(hello.nonce, clientNonce, endpointPath, hello.clientApi, hello.features), Buffer.from(hello.serverSig, 'base64')) !== 'ok') {
    throw new ServerAuthError('bad-server-sig', 'serverSig does not verify: not the kernel (§4.9)');
  }
}

/** The device's auth signature (domain gnomon:auth:v1, §4.9 preimage). */
export function signAuth(cred: DeviceCredential, hello: HelloResult, endpointPath: string): string {
  const msg = clientAuthMessage(hello.nonce, hello.serverKeyId, cred.principalId, cred.deviceId, endpointPath, hello.clientApi, hello.features);
  return Buffer.from(cred.signer.sign('auth', msg)).toString('base64');
}

export class RpcConnection {
  readonly #conn: net.Socket;
  readonly #decoder = new NdjsonDecoder();
  readonly #pending = new Map<RpcId, (f: RpcResponseFrame) => void>();
  #nextId = 1;
  #closed = false;
  readonly #listeners = new Set<(method: string, params: unknown) => void>();

  private constructor(conn: net.Socket) {
    this.#conn = conn;
    conn.on('data', (chunk: Buffer) => {
      for (const item of this.#decoder.push(chunk)) {
        if (item.kind !== 'frame') continue;
        if (!Object.hasOwn(item.value, 'id') && typeof item.value.method === 'string') {
          for (const l of this.#listeners) l(item.value.method, item.value.params);
          continue;
        }
        const cb = this.#pending.get(item.value.id as RpcId);
        if (cb) {
          this.#pending.delete(item.value.id as RpcId);
          cb(item.value as unknown as RpcResponseFrame);
        }
      }
    });
    conn.on('close', () => {
      this.#closed = true;
      // every pending request was written: the kernel may or may not have acted on it (T-2026-10-19-009 item 6)
      for (const cb of this.#pending.values()) cb({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: null, error: deliveryUnknownError() });
      this.#pending.clear();
    });
    conn.on('error', () => undefined);
  }

  static open(socketPath: string): Promise<RpcConnection> {
    return new Promise((resolve, reject) => {
      const c = net.connect(socketPath);
      c.once('connect', () => resolve(new RpcConnection(c)));
      c.once('error', reject);
    });
  }

  /** Server notifications (no id), e.g. log.read{follow} `event` frames; returns an unsubscribe function. */
  onNotification(fn: (method: string, params: unknown) => void): () => void {
    this.#listeners.add(fn);
    return () => void this.#listeners.delete(fn);
  }

  get closed(): boolean {
    return this.#closed;
  }

  call(method: string, params?: unknown, timeoutMs = 5000): Promise<RpcResponseFrame> {
    // provably never sent ⇒ connection-closed, never delivery-unknown (that is only for a frame that was written)
    if (this.#closed || !writable(this.#conn)) return Promise.resolve({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id: null, error: closedError() });
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.#pending.delete(id);
        reject(Object.assign(new Error(`gnomon-rpc: ${method} timed out`), { code: 'ETIMEDOUT' }));
      }, timeoutMs);
      this.#pending.set(id, (f) => {
        clearTimeout(t);
        resolve(f);
      });
      this.#conn.write(encodeFrame(requestFrame(id, method, params)), (err) => {
        // the stream refused the bytes outright (destroyed / ended under us): not sent ⇒ connection-closed
        const cb = err && neverSent(err) ? this.#pending.get(id) : undefined;
        if (cb) {
          this.#pending.delete(id);
          cb({ jsonrpc: '2.0', rpc: 'gnomon-rpc:v1', id, error: closedError() });
        }
      });
    });
  }

  /** Write a raw frame (tests: replaying a captured transcript). */
  callRaw(frame: unknown): Promise<RpcResponseFrame> {
    const id = (frame as { id: RpcId }).id;
    return new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#conn.write(encodeFrame(frame));
    });
  }

  close(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    return new Promise((res) => {
      this.#conn.once('close', () => res());
      this.#conn.destroy();
    });
  }
}

/**
 * The connection dropped after the request was written and before its reply:
 * the call may or may not have taken effect. Distinct from `connection-closed`
 * (never sent, so certainly not delivered) and from any kernel answer. A
 * caller must re-read state before retrying a non-idempotent call. Client-local,
 * like connection-closed: it never crosses the wire.
 */
export const DELIVERY_UNKNOWN = 'delivery-unknown' as const;

function deliveryUnknownError(): RpcErrorFrame['error'] {
  return { code: JSON_RPC_CODES.ENGINE, message: 'connection dropped before the reply: delivery unknown', data: refuse({ code: 'ENGINE', data: { reason: 'delivery-unknown' } }) };
}

/** The socket can still take bytes: a write now is a real send (false ⇒ the call is provably never sent). */
function writable(conn: net.Socket): boolean {
  return !conn.destroyed && conn.writable && !conn.writableEnded;
}

/** Write errors that mean the stream never accepted the bytes (vs EPIPE etc., where some may have left). */
export function neverSent(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ERR_STREAM_DESTROYED' || code === 'ERR_STREAM_WRITE_AFTER_END';
}

function closedError(): RpcErrorFrame['error'] {
  return { code: JSON_RPC_CODES.ENGINE, message: 'connection closed', data: refuse({ code: 'ENGINE', data: { reason: 'connection-closed' } }) };
}

export interface ConnectOptions {
  socketPath: string;
  /** The endpoint path the client derived itself (defaults to socketPath). */
  endpointPath?: string;
  client: HelloParams['client'];
  clientApis?: string[];
  features?: string[];
  /** The kernel key from the root-signed registry. Omitted ⇒ serverSig is NOT verified and `serverVerified` is false. */
  serverKey?: ServerKeyPin;
  /** Authenticate with this device key after the server is verified. */
  device?: DeviceCredential;
  /** Or authenticate with a read token string (status, log.read, ref.resolve only): proof of possession, never sent itself. Never with `device`. */
  readToken?: string;
}

export interface GnomonSession {
  conn: RpcConnection;
  hello: HelloResult;
  serverVerified: boolean;
  /** Does the kernel's frozen client surface equal the one this client was built against? (informational, compatible-additive) */
  clientApiIdMatches: boolean;
  principal?: string;
  connId?: string;
  /** Read-token sessions: when the token (and so this connection) ends. */
  expiresAt?: string;
}

/** hello (+ serverSig check) (+ auth). Throws RefusedError / ServerAuthError; never sends auth to an unverified server. */
export async function connectGnomon(o: ConnectOptions): Promise<GnomonSession> {
  // validate the options before any connection exists
  if (o.device && o.readToken !== undefined) throw new TypeError('gnomon-rpc: authenticate with a device key OR a read token, not both');
  const token = o.readToken !== undefined ? parseReadToken(o.readToken) : undefined;
  const endpointPath = o.endpointPath ?? o.socketPath;
  const conn = await RpcConnection.open(o.socketPath);
  try {
    const clientNonce = newClientNonce();
    const h = await conn.call('hello', { clientApis: o.clientApis ?? ['gnomon-rpc:v1'], features: o.features ?? [], clientNonce, client: o.client });
    if ('error' in h) throw new RefusedError(h.error.data, h.error.message);
    const hello = h.result as HelloResult;
    // client-local check: the kernel must choose from what THIS client offered
    const offeredApis = o.clientApis ?? ['gnomon-rpc:v1'];
    const offeredFeatures = o.features ?? [];
    if (!offeredApis.includes(hello.clientApi) || !Array.isArray(hello.features) || hello.features.some((f) => !offeredFeatures.includes(f))) {
      throw new ServerAuthError('hello-not-offered', 'hello chose a clientApi or feature this client did not offer');
    }
    // client-local check, pinned or not: the hello must echo THIS connection's nonce (T-2026-10-18-016)
    if (hello.clientNonce !== clientNonce) throw new ServerAuthError('client-nonce-mismatch', 'hello does not echo this connection\'s clientNonce: a replayed hello (§4.9)');
    let serverVerified = false;
    if (o.serverKey) {
      verifyServerHello(hello, endpointPath, o.serverKey, clientNonce);
      serverVerified = true;
    }
    const session: GnomonSession = { conn, hello, serverVerified, clientApiIdMatches: hello.clientApiId === CLIENT_API_ID };
    if (token) {
      // the proof goes only to a server that proved it holds the kernel key (§4.9)
      if (!serverVerified) throw new ServerAuthError('unverified-server', 'refusing to authenticate a read token to an unverified server (no registered kernel key)');
      const msg = authTokenMessage(hello.nonce, hello.serverKeyId, token.tokenId, endpointPath, { clientApi: hello.clientApi, features: hello.features });
      const a = await conn.call('auth', { tokenId: token.tokenId, sig: Buffer.from(token.signer.sign('authToken', msg)).toString('base64') });
      if ('error' in a) throw new RefusedError(a.error.data, a.error.message);
      const r = a.result as { principal: string; connId: string; expiresAt: string };
      session.principal = r.principal;
      session.connId = r.connId;
      session.expiresAt = r.expiresAt;
    }
    if (o.device) {
      if (!serverVerified) throw new ServerAuthError('unverified-server', 'refusing to authenticate to an unverified server (no registered kernel key)');
      const a = await conn.call('auth', { principal: o.device.principalId, deviceId: o.device.deviceId, sig: signAuth(o.device, hello, endpointPath) });
      if ('error' in a) throw new RefusedError(a.error.data, a.error.message);
      const r = a.result as { principal: string; connId: string };
      session.principal = r.principal;
      session.connId = r.connId;
    }
    return session;
  } catch (err) {
    await conn.close();
    throw err;
  }
}

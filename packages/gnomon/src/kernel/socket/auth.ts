/**
 * @symbol #socket
 * @symbol #identity
 *
 * #socket mutual authentication (spec §4.9, S-H4; §3.1 device keys).
 *
 *   hello {clientApis, features, clientNonce, client}
 *         → {clientApi, features, nonce, clientNonce, serverKeyId, serverSig, clientApiId, kitId}
 *           serverSig = kernel key over 'gnomon:auth-server:v1\n'+nonce+'\n'+clientNonce+'\n'+endpointPath
 *                       +'\n'+clientApi+'\n'+canonicalJson(features)
 *   auth  {principal, deviceId, sig}
 *           sig = device key over 'gnomon:auth:v1\n'+nonce+'\n'+serverKeyId+'\n'+principalId+'\n'+deviceId+'\n'+endpointPath
 *                       +'\n'+clientApi+'\n'+canonicalJson(features)
 *         → {principal, connId}
 *
 * DEVIATION (round 2, downgrade-proofing): both preimages extend the §4.9
 * text with the NEGOTIATED clientApi and features, so a relay that rewrites
 * the hello offer cannot pick a version neither signature covers. The
 * contracts carry it since M1.4 slice 3 (authServerMessage/authClientMessage);
 * the spec §4.9 text still needs the same change (T-2026-10-17-017).
 *
 * CLIENT NONCE (T-2026-10-18-016): the client sends a fresh random
 * `clientNonce`; the kernel echoes it and binds it into serverSig. Before it,
 * serverSig covered only a nonce the SERVER picked, so a same-user process
 * that recorded one genuine hello could replay it verbatim from a squatted
 * endpoint and pass every client check. Now each client verifies the
 * signature over the nonce IT sent: a replayed hello carries another
 * connection's clientNonce and fails (client-nonce-mismatch / bad-server-sig).
 *
 * The nonce is per connection, single-use (ANY auth attempt consumes it) and
 * valid 30 s. The device must resolve in the ROOT-signed registry (registry.ts,
 * cached by size+mtime+sha256 so a new row applies at once; revocation is M1.3),
 * its principal must equal the claimed one, and the signature must verify
 * under the registered key. A transcript accepted once is remembered by the
 * digest of its signature: presenting it again — on this or another
 * connection — is `socket.auth.replay`, and fails anyway because each
 * connection's nonce differs. Every failure is AUTH and closes the connection
 * after the one refusal (dispatch.ts). `{launchToken}` and `{reconnect}` are
 * the WEB endpoint's forms (#web-endpoint, web/endpoint.ts supplies the
 * `web` hook): on the unix socket they stay UNSUPPORTED
 * `web-auth-not-implemented`. A GUI connection authenticates with
 * `credential: 'gui'` as the launching device's human principal.
 *
 * READ TOKENS (M1.4 slice 3, P8-D89a: proof of possession):
 * `auth {tokenId, sig}` — exactly those keys — after a hello on this
 * connection and inside its nonce TTL. sig is the token's own Ed25519 key over
 * `gnomon:auth-token:v1` + contracts authTokenMessage(nonce, serverKeyId,
 * tokenId, endpointPath, negotiated hello); the kernel verifies it against the
 * public key in the ROOT-signed token file (identity/read-token.ts). The token
 * seed never crosses the wire, so a relay that cannot sign as the kernel sees
 * only a signature bound to a nonce and an endpoint path it cannot reuse.
 * Unknown, expired, not yet valid, revoked (sticky), bad signature, replayed,
 * already live on another connection (one at a time), untrusted token file
 * or root-unprovisioned ⇒ AUTH + close. Success binds the connection to the
 * token's principal with `credential: 'read-token'`: matrix class
 * `readToken` (§5: status, log.read, ref.resolve only) whatever that
 * principal's kind. Rows name the token only by `tokenId`.
 *
 * The preimages come from gnomon-contracts (authServerMessage /
 * authClientMessage with the negotiated hello — T-2026-10-17-017), so kernel
 * and clients sign one definition.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  CLIENT_API_ID,
  DEVICE_ID_PATTERN,
  GNOMON_RPC_V1,
  KIT_ID,
  authClientMessage,
  authServerMessage,
  negotiateHello,
  parsePrincipalId,
  validateHelloParams,
  type HelloParams,
  type HelloResult,
  type PrincipalKind,
} from '@a-company/gnomon-contracts';
import { RegistryCache, type RowVerifier } from '../identity/registry.js';
import { ReadTokenStore, type ReadTokenResolution, type ReadTokenStoreOptions } from '../identity/read-token.js';
import { KeyRing, type Signer } from '../log/signer.js';
import { refusalWith, type RefusalWithMessage } from './rpc.js';

export const NONCE_TTL_MS = 30_000;
export const SERVER_CLIENT_APIS: readonly string[] = Object.freeze([GNOMON_RPC_V1]);
export const SERVER_FEATURES: readonly string[] = Object.freeze([]);
/** Bound on client-supplied strings that reach the log (name, version, surface). */
export const MAX_CLIENT_FIELD = 128;
/** Accepted transcripts remembered for replay detection. */
export const ACCEPTED_TTL_MS = 60 * 60 * 1000;
export const ACCEPTED_MAX = 10_000;

export interface ConnAuthState {
  connId: string;
  phase: 'new' | 'hello' | 'authenticated' | 'closed';
  nonce?: string;
  nonceAt?: number;
  clientApi?: string;
  features?: string[];
  client?: HelloParams['client'];
  principal?: string;
  /** The device principal's kind; absent on a read-token connection (a token is not a principal kind). */
  principalKind?: PrincipalKind;
  /** How the connection authenticated: a device key (the principal's own class), a read token (class `readToken`) or a GUI token (#web-endpoint, the launching device's human). */
  credential?: 'device' | 'read-token' | 'gui';
  /** GUI connections: how the GUI token was obtained. */
  via?: 'launch' | 'reconnect';
  deviceId?: string;
  keyId?: string;
  tokenId?: string;
  tokenExpiresAt?: string;
  tokenExpiresAtMs?: number;
}

/** serverSig message (after the signer's `gnomon:auth-server:v1\n` domain prefix) — the contracts definition. */
export function serverSigMessage(nonce: string, clientNonce: string, endpointPath: string, clientApi: string, features: readonly string[]): string {
  return authServerMessage(nonce, clientNonce, endpointPath, { clientApi, features });
}

/** Client auth message (after the signer's `gnomon:auth:v1\n` domain prefix) — the contracts definition. */
export function clientAuthMessage(
  nonce: string,
  serverKeyId: string,
  principalId: string,
  deviceId: string,
  endpointPath: string,
  clientApi: string,
  features: readonly string[],
): string {
  return authClientMessage(nonce, serverKeyId, principalId, deviceId, endpointPath, { clientApi, features });
}

export type HelloOutcome = { ok: true; result: HelloResult } | ({ ok: false; offered?: string[] } & RefusalWithMessage);

/** A row the dispatcher writes (best-effort) before an auth refusal, e.g. socket.auth.reconnect.requested. */
export interface AuthRow {
  kind: 'socket.auth.reconnect.requested';
  payload: Record<string, unknown>;
}

export type AuthFailure = { ok: false; reason: string; replay: boolean; deviceId?: string; principalClaimed?: string; tokenId?: string; logKind?: 'socket.auth.theft'; logPayload?: Record<string, unknown>; preRows?: AuthRow[] } & RefusalWithMessage;

export type AuthOutcome =
  | { ok: true; credential: 'device'; principal: string; principalKind: PrincipalKind; deviceId: string; keyId: string }
  | { ok: true; credential: 'read-token'; principal: string; tokenId: string; expiresAt: string }
  | {
      ok: true;
      credential: 'gui';
      principal: string;
      principalKind: 'human';
      deviceId: string;
      via: 'launch' | 'reconnect';
      guiToken: string;
      /** The auth rows are written: the GUI session is live. */
      commit(): void;
      /** The auth rows could not be written (or the connection went away): withdraw the GUI session. */
      abort(): void;
    }
  | AuthFailure;

/** The web endpoint's `{launchToken}` / `{reconnect}` handler (#web-endpoint); called after the nonce checks. */
export type WebAuthHook = (conn: ConnAuthState, params: Record<string, unknown>) => AuthOutcome;

export interface AuthenticateOptions {
  /** Is this token already bound to another live connection? (one live connection per token) */
  tokenInUse?: (tokenId: string) => boolean;
  /** Present only on the web endpoint's dispatcher. */
  web?: WebAuthHook;
}

export interface AuthFailExtra {
  replay?: boolean;
  deviceId?: string;
  principalClaimed?: string;
  tokenId?: string;
  code?: 'AUTH' | 'UNSUPPORTED';
  data?: Record<string, unknown>;
  logKind?: 'socket.auth.theft';
  logPayload?: Record<string, unknown>;
  preRows?: AuthRow[];
}

/** An auth refusal (AUTH unless `code` says otherwise); the dispatcher answers it once and closes. */
export function authFail(reason: string, message: string, extra: AuthFailExtra = {}): AuthFailure {
  return {
    ok: false,
    reason,
    replay: extra.replay ?? false,
    ...(extra.deviceId ? { deviceId: extra.deviceId } : {}),
    ...(extra.principalClaimed ? { principalClaimed: extra.principalClaimed } : {}),
    ...(extra.tokenId ? { tokenId: extra.tokenId } : {}),
    ...(extra.logKind ? { logKind: extra.logKind } : {}),
    ...(extra.logPayload ? { logPayload: extra.logPayload } : {}),
    ...(extra.preRows ? { preRows: extra.preRows } : {}),
    ...refusalWith(extra.code ?? 'AUTH', reason, message, extra.data),
  };
}

export interface AuthenticatorOptions {
  home: string;
  endpointPath: string;
  kernelSigner: Signer;
  trust: RowVerifier;
  clock?: () => number;
  nonceTtlMs?: number;
  /** Sticky revocations from the chain and the store's diagnostics hooks (daemon.ts). */
  readTokens?: ReadTokenStoreOptions;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export class SocketAuthenticator {
  readonly #o: AuthenticatorOptions;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #accepted = new Map<string, number>(); // sha256(sig) → accepted at
  readonly #registry: RegistryCache;
  readonly #tokens: ReadTokenStore;

  constructor(o: AuthenticatorOptions) {
    this.#o = o;
    this.#registry = new RegistryCache(o.home, o.trust);
    this.#tokens = new ReadTokenStore(o.home, o.trust, o.readTokens);
    this.#now = o.clock ?? Date.now;
    this.#ttl = o.nonceTtlMs ?? NONCE_TTL_MS;
  }

  get serverKeyId(): string {
    return this.#o.kernelSigner.keyId;
  }

  /** The auth clock (nonce and token expiry). */
  now(): number {
    return this.#now();
  }

  /** Re-read the token file now (daemon start and its slow timer: records pending revocations). */
  refreshTokens(): void {
    this.#tokens.get();
  }

  /** Re-check a live read-token connection's token (expiry, revocation). */
  checkToken(tokenId: string): ReadTokenResolution {
    return this.#tokens.check(tokenId, this.#now());
  }

  hello(conn: ConnAuthState, params: unknown): HelloOutcome {
    if (conn.phase !== 'new') return { ok: false, ...refusalWith('BAD_REQUEST', 'hello-repeated', 'hello is answered once per connection') };
    const errors = validateHelloParams(params, { mode: 'tolerant' });
    if (errors.length) return { ok: false, ...refusalWith('BAD_REQUEST', 'hello-params', 'hello params do not validate', { errors: errors.slice(0, 8) }) };
    const p = params as HelloParams;
    for (const [k, v] of [['client.name', p.client.name], ['client.version', p.client.version], ['client.surface', p.client.surface]] as const) {
      if (typeof v === 'string' && v.length > MAX_CLIENT_FIELD) {
        return { ok: false, ...refusalWith('BAD_REQUEST', 'hello-params', `${k} exceeds ${MAX_CLIENT_FIELD} characters`) };
      }
    }
    const n = negotiateHello(p, SERVER_CLIENT_APIS, SERVER_FEATURES);
    if (!n.ok) {
      const offered = (n.refusal.data?.offered as string[] | undefined) ?? [];
      return {
        ok: false,
        offered,
        refusal: { ...n.refusal, data: { ...n.refusal.data, reason: 'no-shared-client-api', supported: [...SERVER_CLIENT_APIS] } },
        message: `this kernel speaks ${SERVER_CLIENT_APIS.join(', ')}; the client offered none of them`,
      };
    }
    const nonce = randomBytes(32).toString('base64url');
    // T-2026-10-18-016: the client's own nonce is echoed and signed over (validated by validateHelloParams)
    const clientNonce = p.clientNonce;
    const serverSig = Buffer.from(this.#o.kernelSigner.sign('authServer', serverSigMessage(nonce, clientNonce, this.#o.endpointPath, n.clientApi, n.features))).toString('base64');
    conn.phase = 'hello';
    conn.nonce = nonce;
    conn.nonceAt = this.#now();
    conn.clientApi = n.clientApi;
    conn.features = n.features;
    conn.client = p.client;
    return {
      ok: true,
      result: { clientApi: n.clientApi, features: n.features, nonce, clientNonce, serverKeyId: this.serverKeyId, serverSig, clientApiId: CLIENT_API_ID, kitId: KIT_ID },
    };
  }

  authenticate(conn: ConnAuthState, params: unknown, opts: AuthenticateOptions = {}): AuthOutcome {
    const fail = (reason: string, message: string, extra: AuthFailExtra = {}): AuthOutcome => authFail(reason, message, extra);
    if (conn.phase === 'authenticated') return fail('already-authenticated', 'this connection is already authenticated; its nonce is spent', { replay: true });
    if (conn.phase !== 'hello' || !conn.nonce || conn.nonceAt === undefined) return fail('no-hello', 'auth needs a hello on this connection first');
    // Any attempt consumes the nonce. (Every failure also closes the connection,
    // so a second attempt on one nonce cannot arrive; clearing it is defence in depth.)
    const nonce = conn.nonce;
    const nonceAt = conn.nonceAt;
    conn.nonce = undefined;
    conn.nonceAt = undefined;
    if (this.#now() - nonceAt > this.#ttl) return fail('nonce-expired', `the hello nonce is valid ${this.#ttl / 1000} s`);
    if (!isObj(params)) return fail('auth-params', 'auth params must be an object');
    if ('tokenId' in params || 'token' in params) {
      // Aegis C3: a read token authenticates on the unix socket only (one live connection per token cannot span two
      // endpoints' dispatchers); the GUI needs only launchToken and reconnect.
      if (opts.web) return fail('auth-params', 'read tokens authenticate on the unix socket only, not on the web endpoint');
      return this.#authToken(conn, nonce, params, opts, fail);
    }
    if ('launchToken' in params || 'reconnect' in params) {
      if (opts.web) return opts.web(conn, params);
      return fail('web-auth-not-implemented', 'GUI launch/reconnect auth is accepted on the web endpoint only (#web-endpoint)', { code: 'UNSUPPORTED', data: { transport: 'socket' } });
    }
    const { principal, deviceId, sig } = params;
    const devOk = typeof deviceId === 'string' && DEVICE_ID_PATTERN.test(deviceId);
    const principalOk = typeof principal === 'string' && parsePrincipalId(principal) !== undefined;
    const ids = { ...(devOk ? { deviceId: deviceId as string } : {}), ...(principalOk ? { principalClaimed: principal as string } : {}) };
    if (!devOk || !principalOk || typeof sig !== 'string' || sig.length === 0 || sig.length > 256) {
      return fail('auth-params', 'auth needs {principal, deviceId, sig}', ids);
    }
    const sigBytes = Buffer.from(sig, 'base64');
    const digest = createHash('sha256').update(sigBytes).digest('hex');
    this.#prune();
    if (this.#accepted.has(digest)) return fail('replayed-transcript', 'this auth transcript was already accepted once', { ...ids, replay: true });
    if (parsePrincipalId(principal as string)!.foreign) return fail('foreign-principal', 'a principal of another trust set never authenticates here (I5)', ids);
    if (this.#o.trust.rootKeyId === null) {
      return fail('root-unprovisioned', 'no root key: the device registry cannot resolve until #identity M1.3', { ...ids, data: { milestone: 'M1.3' } });
    }
    const dev = this.#registry.get().devices.get(deviceId as string);
    if (!dev) return fail('unknown-device', 'device is not in the root-signed registry', ids);
    if (dev.principalId !== principal) return fail('principal-mismatch', 'device is registered to another principal', ids);
    if (dev.principalKind === 'peer') return fail('peer-not-client', 'peers are not clients (S32-01)', ids);
    const ring = new KeyRing();
    ring.addEd25519(dev.publicKeyPem);
    const msg = clientAuthMessage(nonce, this.serverKeyId, principal as string, deviceId as string, this.#o.endpointPath, conn.clientApi!, conn.features ?? []);
    if (ring.verify(dev.keyId, 'auth', msg, sigBytes) !== 'ok') return fail('bad-signature', 'auth signature does not verify', ids);
    this.#accepted.set(digest, this.#now());
    if (this.#accepted.size > ACCEPTED_MAX) this.#accepted.delete(this.#accepted.keys().next().value!);
    conn.phase = 'authenticated';
    conn.principal = dev.principalId;
    conn.principalKind = dev.principalKind;
    conn.credential = 'device';
    conn.deviceId = dev.deviceId;
    conn.keyId = dev.keyId;
    return { ok: true, credential: 'device', principal: dev.principalId, principalKind: dev.principalKind, deviceId: dev.deviceId, keyId: dev.keyId };
  }

  /** `auth {tokenId, sig}`: the nonce is already consumed and in date (authenticate). */
  #authToken(
    conn: ConnAuthState,
    nonce: string,
    params: Record<string, unknown>,
    opts: AuthenticateOptions,
    fail: (reason: string, message: string, extra?: { tokenId?: string; replay?: boolean; data?: Record<string, unknown> }) => AuthOutcome,
  ): AuthOutcome {
    const keys = Object.keys(params).sort();
    // a bearer `{token}` (the seed) is never accepted: proof of possession only
    if (keys.length !== 2 || keys[0] !== 'sig' || keys[1] !== 'tokenId') return fail('auth-params', 'read-token auth is exactly {tokenId, sig}; the token itself never travels');
    const r = this.#tokens.verify(params.tokenId, params.sig, { nonce, serverKeyId: this.serverKeyId, endpointPath: this.#o.endpointPath, negotiated: { clientApi: conn.clientApi!, features: conn.features ?? [] } }, this.#now());
    if (!r.ok) {
      if (r.reason === 'root-unprovisioned') return fail('root-unprovisioned', 'no root key: read tokens cannot resolve until #identity M1.3', { data: { milestone: 'M1.3' } });
      const why: Record<string, string> = {
        'unknown-token': 'not a read token this kernel issued',
        'token-expired': 'the read token has expired',
        'token-revoked': 'the read token was revoked',
        'token-not-yet-valid': 'the read token is not valid yet',
        'token-store-untrusted': 'the read-token file is not an append-only extension of what the kernel saw; no token resolves',
      };
      return fail(r.reason, why[r.reason]!, r.tokenId ? { tokenId: r.tokenId } : {});
    }
    const digest = createHash('sha256').update(Buffer.from(params.sig as string, 'base64')).digest('hex');
    this.#prune();
    if (this.#accepted.has(digest)) return fail('replayed-transcript', 'this auth transcript was already accepted once', { tokenId: r.tokenId, replay: true });
    if (opts.tokenInUse?.(r.tokenId)) return fail('token-in-use', 'this read token is bound to another live connection (one at a time)', { tokenId: r.tokenId });
    this.#accepted.set(digest, this.#now());
    conn.phase = 'authenticated';
    conn.credential = 'read-token';
    conn.principal = r.principalId;
    conn.principalKind = undefined;
    conn.tokenId = r.tokenId;
    conn.tokenExpiresAt = r.expiresAt;
    conn.tokenExpiresAtMs = r.expiresAtMs;
    return { ok: true, credential: 'read-token', principal: r.principalId, tokenId: r.tokenId, expiresAt: r.expiresAt };
  }

  #prune(): void {
    const cutoff = this.#now() - ACCEPTED_TTL_MS;
    for (const [k, at] of this.#accepted) {
      if (at >= cutoff) break; // insertion order = time order
      this.#accepted.delete(k);
    }
  }
}

/**
 * @symbol #socket
 * @symbol #identity
 *
 * #socket mutual authentication (spec §4.9, S-H4; §3.1 device keys).
 *
 *   hello → {clientApi, features, nonce, serverKeyId, serverSig, clientApiId, kitId}
 *           serverSig = kernel key over 'gnomon:auth-server:v1\n'+nonce+'\n'+endpointPath
 *                       +'\n'+clientApi+'\n'+canonicalJson(features)
 *   auth  {principal, deviceId, sig}
 *           sig = device key over 'gnomon:auth:v1\n'+nonce+'\n'+serverKeyId+'\n'+principalId+'\n'+deviceId+'\n'+endpointPath
 *                       +'\n'+clientApi+'\n'+canonicalJson(features)
 *         → {principal, connId}
 *
 * DEVIATION (round 2, downgrade-proofing): both preimages extend the §4.9
 * text with the NEGOTIATED clientApi and features, so a relay that rewrites
 * the hello offer cannot pick a version neither signature covers. The spec
 * and contracts' authServerPreimage/authClientPreimage need the same change.
 *
 * The nonce is per connection, single-use (ANY auth attempt consumes it) and
 * valid 30 s. The device must resolve in the ROOT-signed registry (registry.ts,
 * cached by size+mtime+sha256 so a new row applies at once; revocation is M1.3),
 * its principal must equal the claimed one, and the signature must verify
 * under the registered key. A transcript accepted once is remembered by the
 * digest of its signature: presenting it again — on this or another
 * connection — is `socket.auth.replay`, and fails anyway because each
 * connection's nonce differs. Every failure is AUTH and closes the connection
 * after the one refusal (dispatch.ts). `{token}` (read tokens), `{launchToken}`
 * and `{reconnect}` (the web endpoint) are later M1.4 slices: UNSUPPORTED.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  CLIENT_API_ID,
  DEVICE_ID_PATTERN,
  GNOMON_RPC_V1,
  KIT_ID,
  canonicalJson,
  negotiateHello,
  parsePrincipalId,
  validateHelloParams,
  type HelloParams,
  type HelloResult,
  type PrincipalKind,
} from '@a-company/gnomon-contracts';
import { RegistryCache, type RowVerifier } from '../identity/registry.js';
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
  principalKind?: PrincipalKind;
  deviceId?: string;
  keyId?: string;
}

// TODO(orchestrator ruling, M1.4 round 3): the clientApi + canonical(features) lines below are a
// deliberate extension of the §4.9 preimages (downgrade-proofing). The coordinator will update
// gnomon-contracts authServerPreimage/authClientPreimage and spec §4.9 in a follow-up; until then
// these helpers, not the contracts ones, define what the kernel signs and verifies.
/** serverSig message (after the signer's `gnomon:auth-server:v1\n` domain prefix). */
export function serverSigMessage(nonce: string, endpointPath: string, clientApi: string, features: readonly string[]): string {
  return `${nonce}\n${endpointPath}\n${clientApi}\n${canonicalJson([...features])}`;
}

/** Client auth message (after the signer's `gnomon:auth:v1\n` domain prefix). */
export function clientAuthMessage(
  nonce: string,
  serverKeyId: string,
  principalId: string,
  deviceId: string,
  endpointPath: string,
  clientApi: string,
  features: readonly string[],
): string {
  return `${nonce}\n${serverKeyId}\n${principalId}\n${deviceId}\n${endpointPath}\n${clientApi}\n${canonicalJson([...features])}`;
}

export type HelloOutcome = { ok: true; result: HelloResult } | ({ ok: false; offered?: string[] } & RefusalWithMessage);

export type AuthOutcome =
  | { ok: true; principal: string; principalKind: PrincipalKind; deviceId: string; keyId: string }
  | ({ ok: false; reason: string; replay: boolean; deviceId?: string; principalClaimed?: string } & RefusalWithMessage);

export interface AuthenticatorOptions {
  home: string;
  endpointPath: string;
  kernelSigner: Signer;
  trust: RowVerifier;
  clock?: () => number;
  nonceTtlMs?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export class SocketAuthenticator {
  readonly #o: AuthenticatorOptions;
  readonly #now: () => number;
  readonly #ttl: number;
  readonly #accepted = new Map<string, number>(); // sha256(sig) → accepted at
  readonly #registry: RegistryCache;

  constructor(o: AuthenticatorOptions) {
    this.#o = o;
    this.#registry = new RegistryCache(o.home, o.trust);
    this.#now = o.clock ?? Date.now;
    this.#ttl = o.nonceTtlMs ?? NONCE_TTL_MS;
  }

  get serverKeyId(): string {
    return this.#o.kernelSigner.keyId;
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
    const serverSig = Buffer.from(this.#o.kernelSigner.sign('authServer', serverSigMessage(nonce, this.#o.endpointPath, n.clientApi, n.features))).toString('base64');
    conn.phase = 'hello';
    conn.nonce = nonce;
    conn.nonceAt = this.#now();
    conn.clientApi = n.clientApi;
    conn.features = n.features;
    conn.client = p.client;
    return {
      ok: true,
      result: { clientApi: n.clientApi, features: n.features, nonce, serverKeyId: this.serverKeyId, serverSig, clientApiId: CLIENT_API_ID, kitId: KIT_ID },
    };
  }

  authenticate(conn: ConnAuthState, params: unknown): AuthOutcome {
    const fail = (reason: string, message: string, extra: { replay?: boolean; deviceId?: string; principalClaimed?: string; code?: 'AUTH' | 'UNSUPPORTED'; data?: Record<string, unknown> } = {}): AuthOutcome => ({
      ok: false,
      reason,
      replay: extra.replay ?? false,
      ...(extra.deviceId ? { deviceId: extra.deviceId } : {}),
      ...(extra.principalClaimed ? { principalClaimed: extra.principalClaimed } : {}),
      ...refusalWith(extra.code ?? 'AUTH', reason, message, extra.data),
    });
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
    if ('token' in params) return fail('token-not-implemented', 'read-token auth lands later in M1.4', { code: 'UNSUPPORTED', data: { milestone: 'M1.4' } });
    if ('launchToken' in params || 'reconnect' in params) {
      return fail('web-auth-not-implemented', 'GUI launch/reconnect auth arrives with #web-endpoint (M1.4)', { code: 'UNSUPPORTED', data: { milestone: 'M1.4' } });
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
    conn.deviceId = dev.deviceId;
    conn.keyId = dev.keyId;
    return { ok: true, principal: dev.principalId, principalKind: dev.principalKind, deviceId: dev.deviceId, keyId: dev.keyId };
  }

  #prune(): void {
    const cutoff = this.#now() - ACCEPTED_TTL_MS;
    for (const [k, at] of this.#accepted) {
      if (at >= cutoff) break; // insertion order = time order
      this.#accepted.delete(k);
    }
  }
}

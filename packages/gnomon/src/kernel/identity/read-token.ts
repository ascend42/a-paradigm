/**
 * @symbol #identity
 *
 * #identity read tokens (spec §4.9 read tokens, §5 "Read tokens: status,
 * log.read, ref.resolve only", §9.3 read-token row; M1.4 slice 3, P8-D89a).
 *
 * A read token is PROOF OF POSSESSION, not a bearer secret:
 *
 *   - The token string `grt:v1:<tokenId body>.<seed>` carries the tokenId and
 *     the 32-byte seed of an Ed25519 key. Only the holder has the seed.
 *   - ISSUANCE IS A ROOT-SIGNED ACT. `mintReadToken` (library only: no socket
 *     verb, no argv) generates the key and appends a root-signed row to
 *     `<home>/keys/read-tokens.jsonl` holding the PUBLIC key only — `{op:
 *     'mint', tokenId, keyId, publicKeyPem, principalId, createdAt, expiresAt}`.
 *     The file holds no secret. With the production UnprovisionedRootAuthority
 *     nothing can be minted and nothing resolves (M1.3), like device keys.
 *   - `auth {tokenId, sig}`: sig = the token key over `gnomon:auth-token:v1` +
 *     contracts authTokenMessage(nonce, serverKeyId, tokenId, endpointPath,
 *     negotiated hello). It is bound to this connection's nonce and to the
 *     endpoint the CLIENT derived, so a relaying impostor that cannot sign as
 *     the kernel gets nothing it can replay anywhere.
 *   - TIME-BOUNDED: default 1 h, at most READ_TOKEN_MAX_TTL_MS (24 h); a row
 *     claiming more never resolves. Not valid before createdAt − 60 s skew.
 *     `mintReadToken`'s `now` must lie within 5 min of the real clock and is
 *     clamped to it (createdAt ≤ real now), so expiresAt ≤ real now + ttl.
 *   - The PoP is verified BEFORE any token state is reported: without a valid
 *     proof every answer is `unknown-token` (no existence or state oracle).
 *   - PRINCIPAL-BOUND, NOT A PRINCIPAL: the row names the principal (root ns,
 *     not kernel, not foreign) for attribution; the connection's matrix class
 *     is `readToken` whatever that principal's kind.
 *   - REVOCABLE AND STICKY: a root-signed `{op:'revoke', tokenId}` row ends a
 *     token. ReadTokenStore keeps every revocation it has ever seen for its
 *     life (deleting the line revives nothing) and reports each new one
 *     (`onRevoked`) so the daemon records `key.token.revoked{tokenId}` on the
 *     chain and seeds the sticky set from the chain at the next start.
 *   - APPEND-ONLY OR UNTRUSTED: if the file stops starting with the bytes
 *     already seen (it shrank, a line was removed or rewritten), the store is
 *     TAMPERED for its life: nothing resolves and `onUntrusted` fires once.
 *     The same holds above READ_TOKEN_MAX_FILE_BYTES / READ_TOKEN_MAX_ROWS.
 *
 * Reading is fail-closed (keys.ts:338-360): unparseable lines, untrusted or
 * bad signatures, malformed rows, a keyId that is not sha256 of its PEM, a
 * second mint of one tokenId or keyId never resolve and are surfaced in
 * `rejected[]`.
 */
import { createPrivateKey, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { authTokenMessage, crockford, parsePrincipalId, type NegotiatedHello } from '@a-company/gnomon-contracts';
import { ed25519KeyId, KeyRing, SoftwareEd25519Signer } from '../log/signer.js';
import { ensureKeysDir, keysDir } from './device-key.js';
import type { RowVerifier } from './registry.js';
import type { RootAuthority } from './root-authority.js';

export const READ_TOKENS_FILE = 'read-tokens.jsonl';
export const READ_TOKEN_ROW_SCHEMA = 'readTokenRow:v1' as const;
export const READ_TOKEN_PREFIX = 'grt:v1:';
/** `grt:v1:<26 Crockford chars of the tokenId>.<base64url 32-byte seed>`; the prefix lets secret scanners find a leak. */
export const READ_TOKEN_PATTERN = /^grt:v1:([0-9A-HJKMNP-TV-Z]{26})\.([A-Za-z0-9_-]{43})$/;
export const READ_TOKEN_ID_PATTERN = /^rtk:[0-9A-HJKMNP-TV-Z]{26}$/;
export const READ_TOKEN_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const READ_TOKEN_DEFAULT_TTL_MS = 60 * 60 * 1000;
/** Clock skew tolerated before a token's createdAt (not-before). */
export const READ_TOKEN_SKEW_MS = 60 * 1000;
/** How far mint's `now` may stray from the real clock. */
export const READ_TOKEN_MINT_CLOCK_BOUND_MS = 5 * 60 * 1000;
export const READ_TOKEN_MAX_FILE_BYTES = 1024 * 1024;
export const READ_TOKEN_MAX_ROWS = 10_000;

/** PKCS#8 DER prefix of an Ed25519 private key; the seed follows. */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export type ReadTokenRow =
  | { schemaVersion: typeof READ_TOKEN_ROW_SCHEMA; op: 'mint'; tokenId: string; keyId: string; publicKeyPem: string; principalId: string; createdAt: string; expiresAt: string }
  | { schemaVersion: typeof READ_TOKEN_ROW_SCHEMA; op: 'revoke'; tokenId: string; at: string };

export interface ReadTokenEntry {
  tokenId: string;
  keyId: string;
  publicKeyPem: string;
  principalId: string;
  createdAt: string;
  createdAtMs: number;
  expiresAt: string;
  expiresAtMs: number;
}

export interface ResolvedReadTokens {
  tokens: Map<string, ReadTokenEntry>;
  revoked: Set<string>;
  rejected: Array<{ line: number; reason: string }>;
}

export type ReadTokenFailure = 'unknown-token' | 'token-expired' | 'token-revoked' | 'token-not-yet-valid' | 'token-store-untrusted' | 'root-unprovisioned';

export type ReadTokenResolution =
  | { ok: true; tokenId: string; principalId: string; expiresAt: string; expiresAtMs: number }
  | { ok: false; reason: ReadTokenFailure; tokenId?: string };

export function readTokensPath(home: string): string {
  return path.join(keysDir(home), READ_TOKENS_FILE);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function isoMs(v: unknown): number | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

function checkRow(row: unknown, ns: string): string | null {
  if (!isObj(row) || row.schemaVersion !== READ_TOKEN_ROW_SCHEMA) return 'schema';
  if (typeof row.tokenId !== 'string' || !READ_TOKEN_ID_PATTERN.test(row.tokenId)) return 'tokenId';
  if (row.op === 'revoke') return isoMs(row.at) === undefined ? 'at' : null;
  if (row.op !== 'mint') return 'op';
  if (typeof row.publicKeyPem !== 'string' || typeof row.keyId !== 'string') return 'key';
  try {
    if (ed25519KeyId(row.publicKeyPem) !== row.keyId) return 'keyId-mismatch';
  } catch {
    return 'key';
  }
  const p = typeof row.principalId === 'string' ? parsePrincipalId(row.principalId) : undefined;
  if (!p || p.foreign || p.ns !== ns || p.name === 'kernel') return 'principal';
  const created = isoMs(row.createdAt);
  const expires = isoMs(row.expiresAt);
  if (created === undefined || expires === undefined || expires <= created) return 'expiresAt';
  if (expires - created > READ_TOKEN_MAX_TTL_MS) return 'ttl';
  return null;
}

/** Resolve read-token file text against the trust set. Never throws on content. */
export function resolveReadTokensText(text: string, trust: RowVerifier): ResolvedReadTokens {
  const out: ResolvedReadTokens = { tokens: new Map(), revoked: new Set(), rejected: [] };
  const keys = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    if (raw.trim() === '') return;
    let rec: unknown;
    try {
      rec = JSON.parse(raw);
    } catch {
      out.rejected.push({ line, reason: 'malformed' });
      return;
    }
    if (!isObj(rec) || typeof rec.signer !== 'string' || typeof rec.sig !== 'string') {
      out.rejected.push({ line, reason: 'unsigned' });
      return;
    }
    if (trust.rootKeyId === null || trust.ns === null) {
      out.rejected.push({ line, reason: 'root-unprovisioned' });
      return;
    }
    if (!trust.verifyRow(rec.signer, rec.row, rec.sig)) {
      out.rejected.push({ line, reason: rec.signer === trust.rootKeyId ? 'bad-signature' : 'untrusted-signer' });
      return;
    }
    const bad = checkRow(rec.row, trust.ns);
    if (bad) {
      out.rejected.push({ line, reason: bad });
      return;
    }
    const row = rec.row as unknown as ReadTokenRow;
    if (row.op === 'revoke') {
      out.revoked.add(row.tokenId); // a revoke may name an id not minted yet: it pins it dead
      return;
    }
    if (out.tokens.has(row.tokenId) || keys.has(row.keyId)) {
      out.rejected.push({ line, reason: 'duplicate-token' });
      return;
    }
    keys.add(row.keyId);
    out.tokens.set(row.tokenId, {
      tokenId: row.tokenId,
      keyId: row.keyId,
      publicKeyPem: row.publicKeyPem,
      principalId: row.principalId,
      createdAt: row.createdAt,
      createdAtMs: Date.parse(row.createdAt),
      expiresAt: row.expiresAt,
      expiresAtMs: Date.parse(row.expiresAt),
    });
  });
  return out;
}

function appendRow(home: string, authority: RootAuthority, row: ReadTokenRow): void {
  const signed = authority.signRow(row); // throws RootUnavailableError (UNSUPPORTED, M1.3) without a root
  ensureKeysDir(home);
  const fd = fs.openSync(readTokensPath(home), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify({ row, ...signed })}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Mint a read token for `principalId` (root-signed row with the public key).
 * Returns the token string — the ONLY time the seed exists outside the
 * caller's memory. A library function: no socket verb and no CLI argv.
 */
export function mintReadToken(
  home: string,
  authority: RootAuthority,
  o: { principalId: string; ttlMs?: number; now?: Date },
): { token: string; tokenId: string; principalId: string; expiresAt: string } {
  if (authority.ns === null) authority.signRow(null); // refuses with the M1.3 refusal
  const ttl = o.ttlMs ?? READ_TOKEN_DEFAULT_TTL_MS;
  if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > READ_TOKEN_MAX_TTL_MS) {
    throw new RangeError(`#identity: a read token lives 1 ms .. ${READ_TOKEN_MAX_TTL_MS} ms (got ${String(ttl)})`);
  }
  const real = Date.now();
  const asked = o.now ?? new Date(real);
  if (!Number.isFinite(asked.getTime()) || Math.abs(asked.getTime() - real) > READ_TOKEN_MINT_CLOCK_BOUND_MS) {
    throw new RangeError('#identity: mint time must lie within 5 min of the real clock');
  }
  // Aegis follow-up 3: the slack may move createdAt EARLIER (a test or a skewed caller), never later —
  // createdAt is clamped to the real clock, so the 5-min slack can never stretch the lifetime past ttl from now.
  const now = new Date(Math.min(asked.getTime(), real));
  const seed = randomBytes(32);
  const signer = signerFromSeed(seed);
  const body = crockford(randomBytes(17)).slice(0, 26);
  const row: ReadTokenRow = {
    schemaVersion: READ_TOKEN_ROW_SCHEMA,
    op: 'mint',
    tokenId: `rtk:${body}`,
    keyId: signer.keyId,
    publicKeyPem: signer.publicKeyPem,
    principalId: o.principalId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
  };
  const bad = checkRow(row, authority.ns!);
  if (bad) throw new TypeError(`#identity: refusing to mint an invalid read token row (${bad})`);
  appendRow(home, authority, row);
  return { token: `${READ_TOKEN_PREFIX}${body}.${seed.toString('base64url')}`, tokenId: row.tokenId, principalId: row.principalId, expiresAt: row.expiresAt };
}

/** Revoke a token by id (root-signed row). Idempotent; an unknown id is still pinned dead. */
export function revokeReadToken(home: string, authority: RootAuthority, tokenId: string, now: Date = new Date()): void {
  if (!READ_TOKEN_ID_PATTERN.test(tokenId)) throw new TypeError('#identity: not a read token id');
  appendRow(home, authority, { schemaVersion: READ_TOKEN_ROW_SCHEMA, op: 'revoke', tokenId, at: now.toISOString() });
}

function signerFromSeed(seed: Buffer): SoftwareEd25519Signer {
  const key = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  return new SoftwareEd25519Signer(key.export({ type: 'pkcs8', format: 'pem' }).toString(), 'readToken');
}

/** The client side of a token: its id and a signer that can only prove possession (domain gnomon:auth-token:v1). */
export interface ReadTokenCredential {
  tokenId: string;
  signer: SoftwareEd25519Signer;
}

export function parseReadToken(token: string): ReadTokenCredential {
  const m = typeof token === 'string' ? READ_TOKEN_PATTERN.exec(token) : null;
  if (!m) throw new TypeError('#identity: not a read token (grt:v1:<id>.<seed>)');
  const seed = Buffer.from(m[2]!, 'base64url');
  if (seed.length !== 32) throw new TypeError('#identity: not a read token (seed)');
  return { tokenId: `rtk:${m[1]}`, signer: signerFromSeed(seed) };
}

export interface ReadTokenStoreOptions {
  /** Revocations already on the chain (key.token.revoked rows): sticky from the first resolve. */
  revoked?: Iterable<string>;
  /** A revocation seen for the first time (the daemon records key.token.revoked). */
  onRevoked?: (tokenId: string) => void;
  /** The file is no longer an append-only extension of what was seen, or exceeds the caps (once). */
  onUntrusted?: (reason: 'rewritten' | 'oversize') => void;
}

/**
 * The kernel's view of `read-tokens.jsonl`. Re-resolved when size, mtime,
 * inode or sha256 change (the RegistryCache rule); revocations are STICKY and
 * the file must only ever grow by appending, or the store stops resolving.
 */
export class ReadTokenStore {
  #key = '';
  #seen: Buffer = Buffer.alloc(0);
  #resolved: ResolvedReadTokens = { tokens: new Map(), revoked: new Set(), rejected: [] };
  #untrusted: 'rewritten' | 'oversize' | null = null;
  readonly #revoked = new Set<string>();
  constructor(
    readonly home: string,
    readonly trust: RowVerifier,
    readonly o: ReadTokenStoreOptions = {},
  ) {
    for (const id of o.revoked ?? []) this.#revoked.add(id);
  }

  /** Revocations this store will honour for its life. */
  revoked(): ReadonlySet<string> {
    return this.#revoked;
  }

  get untrusted(): 'rewritten' | 'oversize' | null {
    return this.#untrusted;
  }

  #distrust(reason: 'rewritten' | 'oversize'): void {
    if (this.#untrusted) return;
    this.#untrusted = reason;
    this.#resolved = { tokens: new Map(), revoked: new Set(), rejected: [] };
    this.o.onUntrusted?.(reason);
  }

  get(): ResolvedReadTokens {
    if (this.#untrusted) return this.#resolved;
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(readTokensPath(this.home));
    } catch {
      st = null;
    }
    const key = st ? `${st.size}:${st.mtimeMs}:${st.ino}` : 'absent';
    if (key === this.#key) return this.#resolved;
    if (st && st.size > READ_TOKEN_MAX_FILE_BYTES) {
      this.#distrust('oversize');
      return this.#resolved;
    }
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(readTokensPath(this.home));
    } catch {
      bytes = Buffer.alloc(0);
    }
    // append-only: what was seen must still be the prefix
    if (bytes.length < this.#seen.length || !bytes.subarray(0, this.#seen.length).equals(this.#seen)) {
      this.#distrust('rewritten');
      return this.#resolved;
    }
    if (bytes.length > READ_TOKEN_MAX_FILE_BYTES) {
      this.#distrust('oversize');
      return this.#resolved;
    }
    this.#key = key;
    if (bytes.length === this.#seen.length && this.#seen.length > 0) return this.#resolved;
    const text = bytes.toString('utf8');
    if (text.split('\n').length - 1 > READ_TOKEN_MAX_ROWS) {
      this.#distrust('oversize');
      return this.#resolved;
    }
    this.#seen = bytes;
    this.#resolved = resolveReadTokensText(text, this.trust);
    for (const id of this.#resolved.revoked) {
      if (this.#revoked.has(id)) continue;
      this.#revoked.add(id);
      this.o.onRevoked?.(id);
    }
    return this.#resolved;
  }

  /**
   * Verify `auth {tokenId, sig}` for this connection's transcript. The proof is
   * checked BEFORE any state is reported (Aegis follow-up 2): without a valid
   * signature by that token's key the answer is a uniform `unknown-token` with
   * no tokenId, so a caller who only knows an id learns nothing about it
   * (minted? revoked? expired?) and no row is attributed to it.
   */
  verify(tokenId: unknown, sigB64: unknown, t: { nonce: string; serverKeyId: string; endpointPath: string; negotiated: NegotiatedHello }, nowMs: number): ReadTokenResolution {
    if (this.trust.rootKeyId === null) return { ok: false, reason: 'root-unprovisioned' };
    const all = this.get();
    if (this.#untrusted) return { ok: false, reason: 'token-store-untrusted' };
    const unknown: ReadTokenResolution = { ok: false, reason: 'unknown-token' };
    if (typeof tokenId !== 'string' || !READ_TOKEN_ID_PATTERN.test(tokenId)) return unknown;
    const e = all.tokens.get(tokenId);
    if (!e || typeof sigB64 !== 'string' || sigB64.length === 0 || sigB64.length > 256) return unknown;
    const ring = new KeyRing();
    ring.addEd25519(e.publicKeyPem);
    const msg = authTokenMessage(t.nonce, t.serverKeyId, tokenId, t.endpointPath, t.negotiated);
    if (ring.verify(e.keyId, 'authToken', msg, Buffer.from(sigB64, 'base64')) !== 'ok') return unknown;
    return this.check(tokenId, nowMs); // the holder proved possession: now its state may be told
  }

  /** The state of a token by id now (auth, the per-call re-check and the sweep). */
  check(tokenId: string, nowMs: number): ReadTokenResolution {
    const all = this.get();
    if (this.#untrusted) return { ok: false, reason: 'token-store-untrusted', tokenId };
    const e = all.tokens.get(tokenId);
    if (!e) return { ok: false, reason: this.#revoked.has(tokenId) ? 'token-revoked' : 'unknown-token', tokenId };
    if (this.#revoked.has(tokenId)) return { ok: false, reason: 'token-revoked', tokenId };
    if (nowMs < e.createdAtMs - READ_TOKEN_SKEW_MS) return { ok: false, reason: 'token-not-yet-valid', tokenId };
    if (nowMs >= e.expiresAtMs) return { ok: false, reason: 'token-expired', tokenId };
    return { ok: true, tokenId: e.tokenId, principalId: e.principalId, expiresAt: e.expiresAt, expiresAtMs: e.expiresAtMs };
  }
}


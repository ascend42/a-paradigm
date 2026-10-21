/**
 * @symbol #gui
 *
 * #gui serverSig verification with WebCrypto Ed25519 (spec §4.9 mutual auth,
 * §11.2 rule 2, S25-M4; `G-GUI-03`). The page verifies the kernel's `hello`
 * signature over `gnomon-contracts` `authServerPreimage(nonce, clientNonce,
 * endpointPath, {clientApi, features})` against the pinned / fragment SPKI key
 * BEFORE it sends `auth`; a mismatch sends nothing and shows "kernel key
 * changed: run `gnomon open`".
 *
 * CLIENT NONCE (T-2026-10-18-016): `clientNonce` is the value THIS page sent
 * in hello. The echo must equal it (`client-nonce-mismatch`) and the
 * signature is checked over the sent value, never the echoed field — a
 * genuine hello recorded on another connection and replayed from a squatted
 * port fails.
 *
 * It also binds `serverKeyId`: the kernel's keyId is `gkey:v1:` + sha256 of
 * the key's normalized SPKI PEM (packages/gnomon/src/kernel/log/signer.ts
 * ed25519KeyId), so the page rebuilds that PEM from the SPKI DER and checks
 * the id names the same key.
 *
 * The bundled pure-JS fallback verifier (§11.1, for an engine without
 * WebCrypto Ed25519) is slice 2: until then such an engine refuses with
 * `webcrypto-ed25519-unavailable` — it never skips the check.
 */
import { CLIENT_NONCE_BYTES, authServerPreimage, hex, sha256, utf8, type HelloResult } from '@a-company/gnomon-contracts';

export type SigVerdict = { ok: true } | { ok: false; reason: 'bad-key' | 'key-id-mismatch' | 'bad-server-sig' | 'client-nonce-mismatch' | 'webcrypto-ed25519-unavailable'; message: string };

/** base64url without padding (the clientNonce wire form). */
export function bytesToBase64Url(b: Uint8Array): string {
  return bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh hello clientNonce: CLIENT_NONCE_BYTES random bytes, base64url. `rng` defaults to the page's crypto.getRandomValues. */
export function newClientNonce(rng: (b: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b)): string {
  return bytesToBase64Url(rng(new Uint8Array(CLIENT_NONCE_BYTES)));
}

export function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(b: Uint8Array): string {
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

/** keyId of an Ed25519 SPKI DER, exactly as the kernel computes it from the PEM. */
export function keyIdOfSpki(spkiDer: Uint8Array): string {
  const body = bytesToBase64(spkiDer).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  const pem = `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----`;
  return `gkey:v1:${hex(sha256(pem))}`;
}

/** Copy into a fresh ArrayBuffer (WebCrypto wants a BufferSource it owns). */
const ab = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

/** Verify a hello result. `subtle` is injected (crypto.subtle in the page; node:crypto webcrypto in tests). */
export async function verifyServerSig(subtle: SubtleCrypto | undefined, spkiB64Url: string, hello: HelloResult, endpointPath: string, clientNonce: string): Promise<SigVerdict> {
  if (hello.clientNonce !== clientNonce) return { ok: false, reason: 'client-nonce-mismatch', message: 'the kernel answered another connection\'s hello: run `gnomon open`' };
  if (!subtle) return { ok: false, reason: 'webcrypto-ed25519-unavailable', message: 'this engine has no WebCrypto; the fallback verifier arrives in M1.10 slice 2' };
  let der: Uint8Array;
  try {
    der = base64UrlToBytes(spkiB64Url);
  } catch {
    return { ok: false, reason: 'bad-key', message: 'the kernel public key is not base64url' };
  }
  if (keyIdOfSpki(der) !== hello.serverKeyId) return { ok: false, reason: 'key-id-mismatch', message: 'kernel key changed: run `gnomon open`' };
  let key: CryptoKey;
  try {
    key = await subtle.importKey('spki', ab(der), { name: 'Ed25519' }, false, ['verify']);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'NotSupportedError') return { ok: false, reason: 'webcrypto-ed25519-unavailable', message: 'this engine has no WebCrypto Ed25519; the fallback verifier arrives in M1.10 slice 2' };
    return { ok: false, reason: 'bad-key', message: 'the kernel public key does not import as Ed25519 SPKI' };
  }
  let sig: Uint8Array;
  try {
    sig = base64ToBytes(hello.serverSig);
  } catch {
    return { ok: false, reason: 'bad-server-sig', message: 'kernel key changed: run `gnomon open`' };
  }
  const msg = utf8(authServerPreimage(hello.nonce, clientNonce, endpointPath, { clientApi: hello.clientApi, features: hello.features }));
  const ok = await subtle.verify({ name: 'Ed25519' }, key, ab(sig), ab(msg));
  return ok ? { ok: true } : { ok: false, reason: 'bad-server-sig', message: 'kernel key changed: run `gnomon open`' };
}

/**
 * Card decision controls exist only on broker-authored `card.actions[]`
 * signed by the kernel key (§4.5, S-M4). The domain is the kernel's
 * (`gnomon:card-action:v1` over `cardId\ndecision\ncontentHash`, broker
 * card.ts); it is not yet in clientApiId — slice 2 takes it from the
 * published client. Returns the decisions whose signature verifies AND whose
 * `keyId` is the kernel key this connection's hello was verified against
 * (`serverKeyId`): an action signed by any other key is not offered.
 */
export const CARD_ACTION_DOMAIN = 'gnomon:card-action:v1';

export async function verifiedDecisions(
  subtle: SubtleCrypto | undefined,
  spkiB64Url: string,
  serverKeyId: string,
  card: { cardId: string; contentHash: string; actions: unknown[] },
): Promise<string[]> {
  if (!subtle || !Array.isArray(card.actions)) return [];
  let key: CryptoKey;
  try {
    const der = base64UrlToBytes(spkiB64Url);
    key = await subtle.importKey('spki', ab(der), { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const a of card.actions) {
    const x = (a && typeof a === 'object' ? a : {}) as { decision?: unknown; sig?: unknown; keyId?: unknown };
    if (typeof x.decision !== 'string' || typeof x.sig !== 'string' || x.keyId !== serverKeyId) continue;
    try {
      const msg = utf8(`${CARD_ACTION_DOMAIN}\n${card.cardId}\n${x.decision}\n${card.contentHash}`);
      if (await subtle.verify({ name: 'Ed25519' }, key, ab(base64ToBytes(x.sig)), ab(msg))) out.push(x.decision);
    } catch {
      /* an unverifiable action is simply not offered */
    }
  }
  return out;
}

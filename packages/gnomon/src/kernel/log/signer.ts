/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.1 key classes + signature domains, §3.2 "Signatures and
 * anchors") — the `Signer` seam and the key ring the verifier uses.
 *
 * THE SEAM. Every signature the log writes goes through `Signer.sign(domain,
 * message)`. The signer, not the caller, prepends the domain, so a signature
 * made for one purpose can never verify for another (domain separation):
 *
 *   preimage = utf8(<domain> + "\n" + <message>)
 *
 * with the §3.1 domains `gnomon:event-sig:v1`, `gnomon:row-sig:v1`,
 * `gnomon:approve:v1`, `gnomon:approve-voice:v1`, `gnomon:auth:v1` and
 * `gnomon:brief:v1`. For an event, `message` is the event's tagged hash
 * (`sha256:<hex>`), so the signature commits to the whole envelope.
 *
 * Each key class may sign only its own domains (§3.1): the kernel key signs
 * events, `hello` serverSig (`gnomon:auth-server:v1`, M1.4 — never the client
 * `gnomon:auth:v1` domain, so the kernel is no signing oracle for client
 * transcripts) and briefs; the root key signs rows
 * (registry, grants, config, install); the approvals key signs decisions.
 *
 * PR-4 ships ONE implementation: `SoftwareEd25519Signer`, the kernel key held
 * in kernel memory. In production the key material comes from the OS keystore
 * item `gnomon-kernel-key` via the signed helper (§3.1); until probes P04
 * (Secure Enclave / helper) and P02 land, a caller hands the PEM in. The root
 * and approvals keys are HARDWARE P-256 and never software (§3.1 failure
 * modes: "never a software fallback, never a file") — their signers plug in
 * behind this same interface after P04/P02. The key ring already VERIFIES
 * `gkey-p256:v1` signatures (ECDSA P-256 / SHA-256, IEEE-P1363 encoding) so
 * those rows verify the day they appear.
 *
 * The interface is synchronous because the kernel key lives in kernel memory
 * (§3.1 "loaded into kernel memory at daemon start") and append runs inside a
 * write transaction. A hardware signer is asynchronous (helper XPC); it will
 * get an async append path that serializes on the chain tip — deferred with
 * the hardware signers.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import { KEY_ID_PATTERN } from '@a-company/gnomon-contracts';

/** The §3.1 signature domains (the prefix before the first `\n`). */
export const SIGNATURE_DOMAINS = {
  event: 'gnomon:event-sig:v1',
  row: 'gnomon:row-sig:v1',
  approve: 'gnomon:approve:v1',
  approveVoice: 'gnomon:approve-voice:v1',
  auth: 'gnomon:auth:v1',
  /** #socket serverSig (§4.9): `gnomon:auth-server:v1\n<nonce>\n<endpointPath>`, kernel key only. */
  authServer: 'gnomon:auth-server:v1',
  /** Read-token proof of possession (§4.9, P8-D89a): the token's own Ed25519 key only. */
  authToken: 'gnomon:auth-token:v1',
  brief: 'gnomon:brief:v1',
  /**
   * #approval-broker (M1.6): the kernel key signs `card.actions[]` and the
   * presence-prompt record (§3.1 kernel key "Signs:"). The spec names no
   * domain string for either; these two are kernel-internal (not in
   * clientApiId) and keep both apart from event signatures.
   */
  cardAction: 'gnomon:card-action:v1',
  presencePrompt: 'gnomon:presence-prompt:v1',
  /** #budget-fuse (M1.6): the kernel key signs every permit:v1 (§4.8 `sig`); kernel-internal domain. */
  permit: 'gnomon:permit:v1',
} as const;
export type SignatureDomain = keyof typeof SIGNATURE_DOMAINS;

/** §3.1 key classes that sign (the link key never signs; X25519, Noise only). */
export type KeyClass = 'kernel' | 'root' | 'approvals' | 'device' | 'agent' | 'readToken';

/** Which domains each key class may sign (§3.1 "Signs:" per class). */
export const DOMAINS_BY_KEY_CLASS: Readonly<Record<KeyClass, readonly SignatureDomain[]>> = Object.freeze({
  kernel: Object.freeze(['event', 'authServer', 'brief', 'cardAction', 'presencePrompt', 'permit'] as const),
  root: Object.freeze(['row', 'event'] as const),
  approvals: Object.freeze(['approve', 'approveVoice', 'event'] as const),
  device: Object.freeze(['auth', 'event'] as const),
  agent: Object.freeze(['auth', 'event'] as const),
  /** A read token's key proves possession on `auth` and signs nothing else (no event, no device auth). */
  readToken: Object.freeze(['authToken'] as const),
});

export type KeyCustody = 'software' | 'hardware';

export interface Signer {
  /** `gkey:v1:<sha256(normalized spki PEM)>` (Ed25519) or `gkey-p256:v1:…`. */
  readonly keyId: string;
  readonly keyClass: KeyClass;
  readonly custody: KeyCustody;
  /** Sign `domain + "\n" + message`; throws if this key class may not sign the domain. */
  sign(domain: SignatureDomain, message: string): Uint8Array;
}

/** The exact bytes a signature covers. */
export function signaturePreimage(domain: SignatureDomain, message: string): Buffer {
  return Buffer.from(`${SIGNATURE_DOMAINS[domain]}\n${message}`, 'utf8');
}

/** The approve-domain message (§3.1): approver in the preimage (Q5). */
export function approveMessage(f: {
  cardId: string;
  decision: string;
  cardContentHash: string;
  approverPrincipalId: string;
}): string {
  return [f.cardId, f.decision, f.cardContentHash, f.approverPrincipalId].join('\n');
}

function normalizePem(pem: string): string {
  return pem.replace(/\n+$/, '');
}

/** keyId for an Ed25519 public key: `gkey:v1:` + sha256(normalized spki PEM). */
export function ed25519KeyId(publicKeyPem: string): string {
  return `gkey:v1:${createHash('sha256').update(normalizePem(publicKeyPem), 'utf8').digest('hex')}`;
}

/** keyId for a P-256 public key: `gkey-p256:v1:` + sha256(spki DER). */
export function p256KeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `gkey-p256:v1:${createHash('sha256').update(der).digest('hex')}`;
}

export class SignerDomainError extends Error {
  constructor(keyClass: KeyClass, domain: SignatureDomain) {
    super(`#kernel-log: a ${keyClass} key may not sign the ${SIGNATURE_DOMAINS[domain]} domain`);
    this.name = 'SignerDomainError';
  }
}

/**
 * The software Ed25519 signer — the kernel key held in memory (PR-4). Also the
 * shape device and agent keys take (they are Ed25519 files, §3.1). Refuses to
 * be constructed as a root or approvals key: those are hardware-only.
 */
export class SoftwareEd25519Signer implements Signer {
  readonly keyId: string;
  readonly keyClass: KeyClass;
  readonly custody = 'software' as const;
  readonly publicKeyPem: string;
  readonly #key: KeyObject;

  constructor(privateKeyPem: string, keyClass: KeyClass = 'kernel') {
    if (keyClass === 'root' || keyClass === 'approvals') {
      throw new Error(`#kernel-log: the ${keyClass} key is hardware-only (spec §3.1); no software signer`);
    }
    this.#key = createPrivateKey(privateKeyPem);
    if (this.#key.asymmetricKeyType !== 'ed25519') throw new Error('#kernel-log: not an Ed25519 private key');
    this.publicKeyPem = normalizePem(createPublicKey(this.#key).export({ type: 'spki', format: 'pem' }).toString());
    this.keyId = ed25519KeyId(this.publicKeyPem);
    this.keyClass = keyClass;
  }

  /** A fresh in-memory kernel key (tests; production loads from the keystore). */
  static generate(keyClass: KeyClass = 'kernel'): SoftwareEd25519Signer {
    const { privateKey } = generateKeyPairSync('ed25519');
    return new SoftwareEd25519Signer(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), keyClass);
  }

  sign(domain: SignatureDomain, message: string): Uint8Array {
    if (!DOMAINS_BY_KEY_CLASS[this.keyClass].includes(domain)) throw new SignerDomainError(this.keyClass, domain);
    return cryptoSign(null, signaturePreimage(domain, message), this.#key);
  }
}

/**
 * Public keys by keyId, for verification. M1.3 (#identity) fills it from the
 * root-signed registry; PR-4 callers add keys directly. Never throws on
 * malformed input: a bad signature or unknown key is simply `false`/`unknown`.
 */
export class KeyRing {
  readonly #keys = new Map<string, KeyObject>();

  addEd25519(publicKeyPem: string): string {
    const keyId = ed25519KeyId(publicKeyPem);
    this.#keys.set(keyId, createPublicKey(publicKeyPem));
    return keyId;
  }

  addP256(publicKey: KeyObject | string): string {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    if (key.asymmetricKeyType !== 'ec') throw new Error('#kernel-log: not an EC public key');
    const keyId = p256KeyId(key);
    this.#keys.set(keyId, key);
    return keyId;
  }

  has(keyId: string): boolean {
    return this.#keys.has(keyId);
  }

  verify(keyId: string, domain: SignatureDomain, message: string, sig: Uint8Array): 'ok' | 'bad' | 'unknown-key' {
    if (!KEY_ID_PATTERN.test(keyId)) return 'unknown-key';
    const key = this.#keys.get(keyId);
    if (!key) return 'unknown-key';
    try {
      const data = signaturePreimage(domain, message);
      const ok = keyId.startsWith('gkey-p256:')
        ? cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig)
        : cryptoVerify(null, data, key, sig);
      return ok ? 'ok' : 'bad';
    } catch {
      return 'bad';
    }
  }
}

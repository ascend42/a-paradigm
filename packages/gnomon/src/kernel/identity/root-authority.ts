/**
 * @symbol #identity
 *
 * #identity (spec §3.1 key classes, I5; M1.4 slice) — the `RootAuthority` seam.
 *
 * The root key is non-exportable hardware P-256 (Secure Enclave via the signed
 * helper / Windows Hello in the Passport KSP) with presence per signature, and
 * it is the ONLY signer of registry rows (I5). That custody arrives with M1.3,
 * which is blocked on the founder's provisioning profile. Until then:
 *
 *   - `UnprovisionedRootAuthority` (the production default): no trust set. It
 *     verifies nothing and signs nothing; `signRow` refuses `UNSUPPORTED`
 *     naming M1.3. With it, no registry row ever resolves, so no device can
 *     authenticate and no client can verify `serverSig` against a registered
 *     kernel key. That is the honest production posture before M1.3 — never a
 *     software fallback (§3.1 failure modes).
 *   - `HardwareRootAuthority` (identity/hardware.ts, M1.3): the Secure Enclave
 *     root behind the signed helper, provisioned by `gnomon identity init`.
 *   - `DevTestRootAuthority`: a SOFTWARE P-256 key in memory, constructible
 *     only by code that passes the literal acknowledgement `DEV_TEST_ROOT_ACK`.
 *     No env var or flag selects it (§15.3: the daemon reads no `GNOMON_*`),
 *     and no file does for the daemon: `gnomond` never constructs it and
 *     refuses a dev home. The ONE file exception is honoured only by the
 *     `gnomon` CLI's `dev up` (#dev-launch): a DEV home's ack-bearing marker
 *     plus its 0600 root key file. It exists so tests can drive
 *     the full mutual-auth path, and so `gnomon dev up` (#dev-launch, the
 *     unsigned dogfood path until M1.3) can run a kernel IN ITS OWN PROCESS on
 *     a separate, marked DEV home — never `~/.gnomon`. Everything it touches reports
 *     `state: 'dev-test'` (status, daemon.start) so it can never pass silently.
 *
 * Row signatures use the §3.1 `gnomon:row-sig:v1` domain over the canonical
 * JSON of the row, ECDSA P-256 / SHA-256 in IEEE-P1363 encoding — the same
 * bytes `KeyRing.verify(…, 'row', …)` checks, so a hardware root drops in
 * behind this interface without changing a verifier.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { canonicalJson, nsFromRootPublicKey, refuse, type Refusal } from '@a-company/gnomon-contracts';
import { KeyRing, p256KeyId, signaturePreimage } from '../log/signer.js';

export type RootState = 'unprovisioned' | 'dev-test' | 'hardware';

/** The ns used for the kernel principal while no root exists (p:00000000/kernel); never a trust-set ns. */
export const UNPROVISIONED_NS = '00000000';

export const DEV_TEST_ROOT_ACK = 'gnomon-dev-test-root:software-key:never-production' as const;

export class RootUnavailableError extends Error {
  readonly refusal: Refusal;
  constructor(what: string) {
    super(`#identity: ${what} needs the hardware root key (M1.3, blocked on hardware provisioning); no software fallback`);
    this.name = 'RootUnavailableError';
    this.refusal = refuse({ code: 'UNSUPPORTED', data: { reason: 'root-unprovisioned', milestone: 'M1.3', what } });
  }
}

export interface RootAuthority {
  readonly state: RootState;
  /** `gkey-p256:v1:<sha256(spki DER)>`, or null when no root exists. */
  readonly rootKeyId: string | null;
  /** The trust-set namespace, or null when no root exists. */
  readonly ns: string | null;
  /** Verify a registry row signature: true only for THIS root (the 8.0 trust set, I5). */
  verifyRow(signer: string, row: unknown, sigB64: string): boolean;
  /** Sign a registry row; throws RootUnavailableError when there is no usable root. */
  signRow(row: unknown): { signer: string; sig: string };
  /** Asynchronous form (M1.3 hardware root: the daemon's helper, so a presence prompt never blocks the event loop). */
  signRowAsync?(row: unknown): Promise<{ signer: string; sig: string }>;
}

export function rowMessage(row: unknown): string {
  return canonicalJson(row);
}

/** Verify-only authority from a root PUBLIC key (what a client pins). */
export class RootVerifier {
  readonly rootKeyId: string;
  readonly ns: string;
  readonly #ring = new KeyRing();

  constructor(rootPublicKey: KeyObject | string) {
    const key = typeof rootPublicKey === 'string' ? createPublicKey(rootPublicKey) : rootPublicKey;
    this.rootKeyId = this.#ring.addP256(key);
    this.ns = nsFromRootPublicKey(new Uint8Array(key.export({ type: 'spki', format: 'der' })));
  }

  verifyRow(signer: string, row: unknown, sigB64: string): boolean {
    if (signer !== this.rootKeyId || typeof sigB64 !== 'string') return false;
    return this.#ring.verify(signer, 'row', rowMessage(row), Buffer.from(sigB64, 'base64')) === 'ok';
  }
}

export class UnprovisionedRootAuthority implements RootAuthority {
  readonly state = 'unprovisioned' as const;
  readonly rootKeyId = null;
  readonly ns = null;
  verifyRow(): boolean {
    return false;
  }
  signRow(): never {
    throw new RootUnavailableError('signing a registry row');
  }
}

export class DevTestRootAuthority implements RootAuthority {
  readonly state = 'dev-test' as const;
  readonly rootKeyId: string;
  readonly ns: string;
  readonly publicKeyPem: string;
  readonly #priv: KeyObject;
  readonly #verifier: RootVerifier;

  /**
   * `opts.privateKeyPem` (#dev-launch, `gnomon dev up`): reload a software
   * root that `gnomon dev init` persisted into a DEV home. It must be a P-256
   * PKCS#8 key; anything else throws. Still needs the ack.
   */
  constructor(ack: typeof DEV_TEST_ROOT_ACK, opts: { privateKeyPem?: string } = {}) {
    if (ack !== DEV_TEST_ROOT_ACK) throw new Error('#identity: DevTestRootAuthority needs the explicit DEV_TEST_ROOT_ACK');
    let privateKey: KeyObject;
    let publicKey: KeyObject;
    if (opts.privateKeyPem !== undefined) {
      privateKey = createPrivateKey(opts.privateKeyPem);
      if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('#identity: a dev-test root key must be EC P-256');
      }
      publicKey = createPublicKey(privateKey);
    } else {
      ({ privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }));
    }
    this.#priv = privateKey;
    this.publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    this.#verifier = new RootVerifier(publicKey);
    this.rootKeyId = p256KeyId(publicKey);
    this.ns = this.#verifier.ns;
  }

  verifyRow(signer: string, row: unknown, sigB64: string): boolean {
    return this.#verifier.verifyRow(signer, row, sigB64);
  }

  signRow(row: unknown): { signer: string; sig: string } {
    const sig = cryptoSign('sha256', signaturePreimage('row', rowMessage(row)), { key: this.#priv, dsaEncoding: 'ieee-p1363' });
    return { signer: this.rootKeyId, sig: sig.toString('base64') };
  }

  /** #dev-launch: the software root as PKCS#8 PEM so `gnomon dev init` can persist it into a DEV home (0600). Needs the ack again. */
  exportPrivateKeyPem(ack: typeof DEV_TEST_ROOT_ACK): string {
    if (ack !== DEV_TEST_ROOT_ACK) throw new Error('#identity: exporting a dev-test root needs the explicit DEV_TEST_ROOT_ACK');
    return this.#priv.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
}

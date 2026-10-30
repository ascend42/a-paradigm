/**
 * @symbol #identity
 *
 * #identity (spec §3.1 kernel key; M1.4 seam until M1.3) — the PUBLIC halves
 * of every kernel key this home has run with, at
 * `<home>/keys/kernel-pub.jsonl` (0600, owner-only, append-only lines
 * `{keyId, publicKeyPem, at}`). The private half is never written anywhere:
 * before M1.3 each daemon start may use an ephemeral in-memory key, and this
 * file lets #kernel-log verify (and #interruptedAck re-anchor) rows signed by
 * earlier runs' keys.
 *
 * HONEST LIMIT: this file is same-user writable and not root-signed, so across
 * restarts a kernel signature proves NOTHING against a same-user forger (who
 * can append their own public key here and sign rows with it). Custody is
 * reported `partial`. M1.3 replaces this with the keystore item and the
 * root-signed kernel-key registry row (§3.1).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ed25519KeyId } from '../log/signer.js';
import { ensureKeysDir, keysDir } from './device-key.js';
import { kernelCertRefusal, sealFilePresent, type KernelCertRecord, type KernelSeal } from './kernel-custody.js';

/**
 * TD-2026-10-29-746 (S2, #kernel-custody): how far an entry is trusted. `certified` — its line carries a kernel cert
 * that verifies under the SEALED kernel-cert key; `legacy` — sealed by the root-signed legacy row (labelled partial);
 * `partial` — no seal exists yet (today's behaviour). After the seal any other entry is refused (not returned).
 */
export type KernelPubCustody = 'certified' | 'legacy' | 'partial';

/** An append the seal refuses: after the seal, only a cert-backed kernel key is recorded. */
export class KernelPubSealed extends Error {
  constructor() {
    super('#identity: kernel-pub.jsonl is sealed; only a kernel key the helper certified is recorded (custody partial)');
    this.name = 'KernelPubSealed';
  }
}

export const KERNEL_PUB_FILE = 'kernel-pub.jsonl';

export interface KernelPubEntry {
  keyId: string;
  publicKeyPem: string;
  /** S2: the kernel cert recorded for this key (a later line may add it) */
  cert?: KernelCertRecord;
  /** S2: set when readKernelPubs was given the seal state */
  custody?: KernelPubCustody;
}

export function kernelPubPath(home: string): string {
  return path.join(keysDir(home), KERNEL_PUB_FILE);
}

/**
 * Every well-formed entry whose keyId is sha256 of its PEM; malformed lines are skipped. A later line for the same key
 * may add its cert. With `o.seal` (S2): `null` = not sealed (every entry `partial`); a seal = only certified and sealed
 * legacy entries are returned. Without `o` the entries are returned as before (no custody label).
 */
export function readKernelPubs(home: string, o?: { seal: KernelSeal | null }): KernelPubEntry[] {
  let text: string;
  try {
    text = fs.readFileSync(kernelPubPath(home), 'utf8');
  } catch {
    return [];
  }
  const out: KernelPubEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as Partial<KernelPubEntry>;
      if (typeof e.publicKeyPem === 'string' && typeof e.keyId === 'string' && ed25519KeyId(e.publicKeyPem) === e.keyId) {
        const cert = e.cert && typeof e.cert === 'object' ? (e.cert as KernelCertRecord) : undefined;
        const had = out.find((x) => x.keyId === e.keyId);
        if (!had) out.push({ keyId: e.keyId, publicKeyPem: e.publicKeyPem, ...(cert ? { cert } : {}) });
        else if (cert && !had.cert) had.cert = cert;
      }
    } catch {
      /* skipped */
    }
  }
  if (!o) return out;
  const seal = o.seal;
  if (!seal) return out.map((e) => ({ ...e, custody: 'partial' as const }));
  const res: KernelPubEntry[] = [];
  for (const e of out) {
    if (e.cert && kernelCertRefusal(e.cert, { kernelKeyId: e.keyId, publicKeyPem: e.publicKeyPem, certKey: seal.certKey }) === null) res.push({ ...e, custody: 'certified' });
    else if (seal.legacyKeyIds.has(e.keyId)) res.push({ ...e, custody: 'legacy' });
  }
  return res;
}

/** Record this run's kernel PUBLIC key (idempotent per keyId); file 0600 in the owner-only keys dir. */
export function recordKernelPub(home: string, publicKeyPem: string, now: Date = new Date(), o: { cert?: KernelCertRecord; sealed?: boolean } = {}): string {
  ensureKeysDir(home);
  const keyId = ed25519KeyId(publicKeyPem);
  // S2: after the seal (a seal file present: refusing on presence alone is the safe side) only a certified key is recorded
  if (!o.cert && (o.sealed ?? sealFilePresent(home))) throw new KernelPubSealed();
  const had = readKernelPubs(home).find((e) => e.keyId === keyId);
  if (had && (had.cert || !o.cert)) return keyId;
  const file = kernelPubPath(home);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify({ keyId, publicKeyPem, at: now.toISOString(), ...(o.cert ? { cert: o.cert } : {}) })}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
  return keyId;
}

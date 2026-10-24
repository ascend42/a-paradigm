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

export const KERNEL_PUB_FILE = 'kernel-pub.jsonl';

export interface KernelPubEntry {
  keyId: string;
  publicKeyPem: string;
}

export function kernelPubPath(home: string): string {
  return path.join(keysDir(home), KERNEL_PUB_FILE);
}

/** Every well-formed entry whose keyId is sha256 of its PEM; malformed lines are skipped. */
export function readKernelPubs(home: string): KernelPubEntry[] {
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
        if (!out.some((x) => x.keyId === e.keyId)) out.push({ keyId: e.keyId, publicKeyPem: e.publicKeyPem });
      }
    } catch {
      /* skipped */
    }
  }
  return out;
}

/** Record this run's kernel PUBLIC key (idempotent per keyId); file 0600 in the owner-only keys dir. */
export function recordKernelPub(home: string, publicKeyPem: string, now: Date = new Date()): string {
  ensureKeysDir(home);
  const keyId = ed25519KeyId(publicKeyPem);
  if (readKernelPubs(home).some((e) => e.keyId === keyId)) return keyId;
  const file = kernelPubPath(home);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify({ keyId, publicKeyPem, at: now.toISOString() })}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
  return keyId;
}

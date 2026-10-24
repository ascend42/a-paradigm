/**
 * @symbol #identity
 *
 * #identity (spec §3.1 data model; M1.3 slice 1) — this Mac's PROVISIONED
 * hardware identity: `<home>/keys/identity.json` (0600, public material
 * only) and opening it for the daemon.
 *
 *   identity:v1 { schemaVersion, gen, rootKeyId, rootPublicKeyPem, ns,
 *                 approvals: { row, signer, sig },        root-signed binding of the
 *                                                         approvals key to its human
 *                 principalId, deviceId, helperPath, createdAt,
 *                 rotatedFrom?: rootKeyId }
 *   approvals row { schemaVersion:'gnomon-approvals-key:v1', keyId, publicKeyPem, principalId, gen }
 *
 * The file is same-user writable, so it is never trusted alone. Opening it
 * (openHardwareIdentity) requires the PINNED signed helper to confirm that
 * the Secure Enclave keys of generation `gen` have exactly these public
 * halves (the SE keys live in an entitlement-gated access group only the
 * signed helper reaches), and the approvals binding must verify under that
 * root. Anything else fails closed: the daemon refuses to start rather than
 * fall back to an unprovisioned or software root.
 *
 * `gnomon identity init` (cli/identity-cli.ts) writes it once; a second init
 * is refused unless an explicit, logged rotate is asked for.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createPublicKey } from 'node:crypto';
import { nsFromRootPublicKey } from '@a-company/gnomon-contracts';
import { p256KeyId } from '../log/signer.js';
import { ensureKeysDir, keysDir } from './device-key.js';
import { HardwareRootAuthority, HelperApprovalsKey, p256FromX963, pemOf } from './hardware.js';
import { helperPathFor } from '../lifecycle/app-bundle.js';
import type { ReleasePins } from '../lifecycle/release-pins.js';
import { helperOnceSync, HelperProcess, HelperRepin, HelperUnavailableError, pinHelper, SupervisedHelper, type HelperTransport, type HelperVerifier, type PinnedHelper } from './helper.js';

export const IDENTITY_FILE = 'identity.json';
export const IDENTITY_JOURNAL_FILE = 'identity.jsonl';
export const IDENTITY_SCHEMA = 'gnomon-identity:v1' as const;
export const APPROVALS_ROW_SCHEMA = 'gnomon-approvals-key:v1' as const;

export interface ApprovalsRow {
  schemaVersion: typeof APPROVALS_ROW_SCHEMA;
  keyId: string;
  publicKeyPem: string;
  principalId: string;
  gen: string;
}

export interface IdentityRecord {
  schemaVersion: typeof IDENTITY_SCHEMA;
  gen: string;
  rootKeyId: string;
  rootPublicKeyPem: string;
  ns: string;
  approvals: { row: ApprovalsRow; signer: string; sig: string };
  principalId: string;
  deviceId: string;
  helperPath: string;
  createdAt: string;
  rotatedFrom?: string;
  /** --recover: the LOST root this identity replaces (a new namespace; nothing signed by it carries over) */
  recoveredFrom?: string;
  /** #provisioner (Aegis HIGH-1): the device key this record was provisioned with */
  deviceKeyId?: string;
  /**
   * #provisioner (Aegis HIGH-1): the device registry row the root signed during THIS record's provisioning,
   * saved with the record so a commit that crashed before the registry append is completed with ZERO new
   * root signatures (completeDevice). Public, root-signed material.
   */
  pendingDeviceRow?: { row: Record<string, unknown>; signer: string; sig: string };
}

export class IdentityError extends Error {
  constructor(
    readonly reason: 'missing' | 'malformed' | 'mismatch' | 'exists' | 'helper',
    message: string,
  ) {
    super(`#identity: ${message}`);
    this.name = 'IdentityError';
  }
}

export function identityPath(home: string): string {
  return path.join(keysDir(home), IDENTITY_FILE);
}

export function identityJournalPath(home: string): string {
  return path.join(keysDir(home), IDENTITY_JOURNAL_FILE);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Read and shape-check identity.json; null when absent. Throws IdentityError(malformed) on a bad file. */
export function readIdentity(home: string): IdentityRecord | null {
  let text: string;
  try {
    const st = fs.lstatSync(identityPath(home));
    if (!st.isFile()) throw new IdentityError('malformed', `${identityPath(home)} is not a regular file`);
    text = fs.readFileSync(identityPath(home), 'utf8');
  } catch (e) {
    if (e instanceof IdentityError) throw e;
    return null;
  }
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new IdentityError('malformed', 'identity.json is not JSON');
  }
  if (!isObj(v) || v.schemaVersion !== IDENTITY_SCHEMA) throw new IdentityError('malformed', 'identity.json has the wrong schema');
  const r = v as unknown as IdentityRecord;
  const ok =
    typeof r.gen === 'string' &&
    /^[a-z0-9]{4,32}$/.test(r.gen) &&
    typeof r.rootPublicKeyPem === 'string' &&
    typeof r.rootKeyId === 'string' &&
    isObj(r.approvals) &&
    isObj(r.approvals.row) &&
    typeof r.approvals.sig === 'string' &&
    typeof r.approvals.signer === 'string' &&
    typeof r.principalId === 'string' &&
    typeof r.deviceId === 'string' &&
    typeof r.helperPath === 'string' &&
    path.isAbsolute(r.helperPath);
  if (!ok) throw new IdentityError('malformed', 'identity.json is missing fields');
  try {
    const key = createPublicKey(r.rootPublicKeyPem);
    if (p256KeyId(key) !== r.rootKeyId) throw new Error('id');
    if (nsFromRootPublicKey(new Uint8Array(key.export({ type: 'spki', format: 'der' }))) !== r.ns) throw new Error('ns');
    if (p256KeyId(createPublicKey(r.approvals.row.publicKeyPem)) !== r.approvals.row.keyId) throw new Error('approvals id');
  } catch {
    throw new IdentityError('malformed', 'identity.json key ids do not match its keys');
  }
  return r;
}

/** Write identity.json O_EXCL at 0600 (an existing file is replaced only by a rotate, which moves it aside first). */
export function writeIdentity(home: string, rec: IdentityRecord): void {
  ensureKeysDir(home);
  const fd = fs.openSync(identityPath(home), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(rec, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Append one line to the identity journal (init / rotate; public, root-signed rows). */
export function appendIdentityJournal(home: string, line: Record<string, unknown>): void {
  ensureKeysDir(home);
  const fd = fs.openSync(identityJournalPath(home), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(line)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** The helper's public key for (key, gen) as a PEM; null when the SE holds none. */
export async function helperPublicKey(helper: HelperTransport, key: 'root' | 'approvals', gen: string): Promise<string | null> {
  try {
    const r = await helper.request({ op: 'key.public', key, gen });
    return pemOf(p256FromX963(String(r.publicKey)));
  } catch (e) {
    if (e instanceof Error && e.name === 'HelperRefusal' && (e as { code?: string }).code === 'not-found') return null;
    throw e;
  }
}

export interface OpenedIdentity {
  record: IdentityRecord;
  root: HardwareRootAuthority;
  approvals: HelperApprovalsKey;
  helper: HelperTransport;
  pin: PinnedHelper;
  /** TD-2026-10-19-063: re-pin a changed helper binary and respawn `serve` (no card; fail closed). */
  repin(): Promise<string>;
}

/**
 * Open this home's hardware identity for the daemon: pin the helper, start
 * it, confirm both SE public keys and the root-signed approvals binding.
 * Returns null when no identity.json exists (unprovisioned). Throws
 * IdentityError / HelperUnavailableError otherwise — fail closed.
 */
export async function openHardwareIdentity(
  home: string,
  o: {
    verifier?: HelperVerifier;
    start?: (pin: PinnedHelper) => HelperTransport;
    /** release pins (default: compiled into this build) */
    pins?: ReleasePins;
    /** where this kernel runs from (default: this module; #app-bundle) */
    from?: string;
  } = {},
): Promise<OpenedIdentity | null> {
  const record = readIdentity(home);
  if (!record) return null;
  // #app-bundle (T-2026-10-21-029): inside a release Gnomon.app the app's own helper, wherever the app now lives;
  // the recorded path otherwise. Trust is the signature + release pin either way (pinHelper), never the path.
  const helperPath = helperPathFor(record.helperPath, o.from);
  let pin: PinnedHelper;
  try {
    pin = pinHelper(helperPath, { ...(o.verifier ? { verifier: o.verifier } : {}), ...(o.pins ? { pins: o.pins } : {}) });
  } catch (e) {
    throw new IdentityError('helper', e instanceof Error ? e.message : 'the helper could not be pinned');
  }
  const start = o.start ?? ((p: PinnedHelper) => HelperProcess.start(p));
  const holder = { pin };
  const helper = new SupervisedHelper(() => start(holder.pin));
  try {
    const [rootPem, apprPem] = [await helperPublicKey(helper, 'root', record.gen), await helperPublicKey(helper, 'approvals', record.gen)];
    if (!rootPem || p256KeyId(createPublicKey(rootPem)) !== record.rootKeyId) throw new IdentityError('mismatch', 'the Secure Enclave root key does not match identity.json');
    if (!apprPem || p256KeyId(createPublicKey(apprPem)) !== record.approvals.row.keyId) throw new IdentityError('mismatch', 'the Secure Enclave approvals key does not match identity.json');
    const root = new HardwareRootAuthority({ gen: record.gen, rootPublicKeyPem: record.rootPublicKeyPem }, { helper, once: helperOnceSync(pin) });
    const a = record.approvals;
    if (a.row.schemaVersion !== APPROVALS_ROW_SCHEMA || a.row.principalId !== record.principalId || a.row.gen !== record.gen || !root.verifyRow(a.signer, a.row, a.sig)) {
      throw new IdentityError('mismatch', 'the approvals key binding is not signed by this root');
    }
    const approvals = new HelperApprovalsKey({ gen: record.gen, approvalsPublicKeyPem: a.row.publicKeyPem }, record.principalId, helper);
    const repinner = new HelperRepin({
      helperPath,
      holder,
      helper,
      ...(o.verifier ? { verifier: o.verifier } : {}),
      ...(o.pins ? { pins: o.pins } : {}),
      confirm: async () => {
        const pem = await helperPublicKey(helper, 'root', record.gen);
        return !!pem && p256KeyId(createPublicKey(pem)) === record.rootKeyId;
      },
    });
    return { record, root, approvals, helper, pin, repin: () => repinner.check() };
  } catch (e) {
    await helper.close().catch(() => undefined);
    if (e instanceof IdentityError) throw e;
    if (e instanceof HelperUnavailableError) throw new IdentityError('helper', e.message);
    throw new IdentityError('helper', e instanceof Error ? e.message : 'the helper did not answer');
  }
}

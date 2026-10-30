/**
 * @symbol #kernel-custody
 *
 * #kernel-custody (TD-2026-10-29-746 slice S2; spec §3.1 kernel key, P8-D68 as amended, G-ID-14) — the kernel's trust
 * in its own ephemeral Ed25519 key, from what helper 1.11.0 offers.
 *
 * KERNEL CERT, every start. When the kernel runs as a signed SEA with a helper ≥ HELPER_OP_MIN['kernel.cert'], it asks
 * `kernel.cert` to certify its key for this log (`requestKernelCert`). The reply is checked here exactly as the helper's
 * own verifier checks it (KernelCert.swift kernelCertRefusal): a P-256 DER signature by the helper's Secure Enclave
 * `kernel-cert` key over `gnomon:kernel-cert:v1\n` + canonical JSON, naming THIS kernel key, THIS boot, THIS log, not
 * expired. The cert is recorded on the kernel's kernel-pub.jsonl line (kernel-pub.ts) and in the signed `daemon.start`
 * row. No SEA, an older helper, an npm-only install, a refused or bad cert: no cert, custody `partial`, nothing breaks.
 *
 * THE SEAL (the migration card). kernel-pub.jsonl is same-user appendable, so on its own it proves nothing. The first
 * start that holds a cert while no seal exists raises ONE root card (`grant`, detail.action `kernel-custody`, row
 * table kernel-custody: helper ≥ 1.11.0) whose single Touch ID signs [the kernel-cert key row, the legacy row]: the
 * helper's cert key is registered, and the kernel keys used before it (every one, by digest; Aegis S2 M-4) are
 * sealed as legacy together with the log head at the seal. The signed rows live in `<home>/keys/kernel-custody.json`
 * (0600) and are re-verified against the root at every start (`readKernelSeal`). After the seal:
 *   - a kernel-pub entry is trusted as kernel-authored only with a cert that verifies under the registered cert key
 *     and binds its key (`certified`); a sealed legacy key stays `legacy` (labelled partial); anything else is refused;
 *   - an append to kernel-pub.jsonl that is not cert-backed is refused (KernelPubSealed).
 * Dismissing the card changes nothing: custody stays `partial` and the card is offered again at the next start.
 *
 * CUSTODY. `full` only when all hold: a valid cert this start, a verified seal whose cert key is the cert's, and the log
 * anchor not in quarantine (log-anchor.ts). Otherwise `partial`, with the reason in status.kernelCustody.
 *
 * Honest limit: deleting kernel-custody.json rolls the seal back to "not sealed" (a same-user file); custody then drops
 * to `partial` and the card returns, which the user sees. The anchor (log-anchor.ts) is what binds the log itself.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeBootId, readBootSession } from '../log/boot.js';
import { ed25519KeyId, type SoftwareEd25519Signer } from '../log/signer.js';
import { KERNEL_CERT_KEY_SCHEMA, KERNEL_LEGACY_SCHEMA, kernelCustodyRefusal, legacyKeysDigest } from './decision-batch.js';
import { ensureKeysDir, keysDir } from './device-key.js';
import { HELPER_OP_MIN, versionAtLeast, type HelperTransport } from './helper.js';

export const KERNEL_CERT_SCHEMA = 'gnomon-kernel-cert:v1';
export const KERNEL_CERT_DOMAIN = 'gnomon:kernel-cert:v1\n';
/** A cert is accepted up to this long before its issuedAt (clock skew), mirroring the helper. */
export const KERNEL_CERT_SKEW_MS = 300_000;
export const KERNEL_CUSTODY_FILE = 'kernel-custody.json';
export const KERNEL_CUSTODY_DOC_SCHEMA = 'gnomon-kernel-custody-doc:v1';

/** What kernel.cert returned, as recorded (base64 fields as the helper sent them). */
export interface KernelCertRecord {
  /** base64 of the exact signed message (domain + canonical JSON) */
  cert: string;
  /** base64 DER ECDSA P-256 */
  sig: string;
  /** base64 X9.63 public key of the helper's kernel-cert key */
  certKey: string;
  /** sha256:<hex> of the X9.63 key */
  certKeyId: string;
}

export interface KernelCertRow {
  schemaVersion: typeof KERNEL_CERT_SCHEMA;
  kernelKeyId: string;
  pub: string;
  logId: string;
  boot: string;
  pid: number;
  pidVersion: number;
  callerCdhash: string;
  startedAt: string;
  issuedAt: string;
  expiresAt: string;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const sha256Tag = (b: Uint8Array): string => `sha256:${createHash('sha256').update(b).digest('hex')}`;

function p256FromX963(raw: Buffer): ReturnType<typeof createPublicKey> | null {
  if (raw.length !== 65 || raw[0] !== 0x04) return null;
  try {
    return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  } catch {
    return null;
  }
}

/** Parse a recorded cert's message; null when it is not a gnomon-kernel-cert:v1 message. */
export function parseKernelCert(rec: Pick<KernelCertRecord, 'cert'>): KernelCertRow | null {
  if (typeof rec.cert !== 'string' || !B64.test(rec.cert) || rec.cert.length > 8192) return null;
  const msg = Buffer.from(rec.cert, 'base64');
  const d = Buffer.from(KERNEL_CERT_DOMAIN, 'utf8');
  if (!msg.subarray(0, d.length).equals(d)) return null;
  try {
    const row = JSON.parse(msg.subarray(d.length).toString('utf8')) as Record<string, unknown>;
    if (row.schemaVersion !== KERNEL_CERT_SCHEMA) return null;
    for (const k of ['kernelKeyId', 'pub', 'logId', 'boot', 'callerCdhash', 'startedAt', 'issuedAt', 'expiresAt']) if (typeof row[k] !== 'string') return null;
    if (!Number.isSafeInteger(row.pid) || !Number.isSafeInteger(row.pidVersion)) return null;
    return row as unknown as KernelCertRow;
  } catch {
    return null;
  }
}

export interface KernelCertCheck {
  /** the kernel key the cert must name */
  kernelKeyId: string;
  publicKeyPem: string;
  /** issuance checks (a fresh cert at start): this boot, this log, this instant */
  boot?: string;
  logId?: string;
  now?: number;
  /** the REGISTERED cert key (base64 X9.63): the cert must be signed by it */
  certKey?: string;
}

/**
 * The TS mirror of the helper's kernelCertRefusal (KernelCert.swift), plus the binding to the kernel key. null = good.
 * Without `boot`/`logId`/`now` it checks a recorded cert for history (signature, schema, key binding) only.
 */
export function kernelCertRefusal(rec: KernelCertRecord, c: KernelCertCheck): string | null {
  if (!rec || typeof rec.certKey !== 'string' || !B64.test(rec.certKey) || typeof rec.sig !== 'string' || !B64.test(rec.sig)) return 'the cert record is malformed';
  const raw = Buffer.from(rec.certKey, 'base64');
  const key = p256FromX963(raw);
  if (!key) return 'the cert key is not a P-256 X9.63 public key';
  if (rec.certKeyId !== sha256Tag(raw)) return "the cert key id is not sha256 of the cert key";
  if (c.certKey !== undefined && rec.certKey !== c.certKey) return 'the cert is signed by another key than the registered kernel-cert key';
  let ok = false;
  try {
    ok = cryptoVerify('sha256', Buffer.from(rec.cert, 'base64'), { key, dsaEncoding: 'der' }, Buffer.from(rec.sig, 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) return 'the cert is not signed by the kernel-cert key';
  const row = parseKernelCert(rec);
  if (!row) return 'not a gnomon-kernel-cert:v1 message';
  if (row.kernelKeyId !== c.kernelKeyId || row.pub !== c.publicKeyPem.replace(/\n+$/, '') || ed25519KeyId(row.pub) !== row.kernelKeyId) return 'the cert names another kernel key';
  if (c.boot !== undefined && normalizeBootId(row.boot) !== normalizeBootId(c.boot)) return 'the cert is from another boot';
  if (c.logId !== undefined && row.logId !== c.logId) return 'the cert names another log';
  if (c.now !== undefined) {
    const iss = Date.parse(row.issuedAt);
    const exp = Date.parse(row.expiresAt);
    if (!Number.isFinite(iss) || !Number.isFinite(exp) || iss > c.now + KERNEL_CERT_SKEW_MS || c.now >= exp) return 'the cert is expired or not yet valid';
  }
  return null;
}

/** Why this start holds no cert (status.kernelCustody.cert.why). */
export type KernelCertMissing = 'not-sea' | 'no-helper' | 'helper-old' | 'refused' | 'bad-cert' | 'boot-unknown';

export interface KernelCertResult {
  cert: KernelCertRecord | null;
  why?: KernelCertMissing;
  detail?: string;
  expiresAt?: string;
}

/**
 * Ask the helper to certify this start's kernel key for `logId`, and check the reply. Never throws: no cert is
 * custody `partial`, never a failed start.
 */
export async function requestKernelCert(o: { helper?: HelperTransport | null; signer: Pick<SoftwareEd25519Signer, 'keyId' | 'publicKeyPem'>; logId: string; sea: boolean; now?: () => number; boot?: () => string }): Promise<KernelCertResult> {
  if (!o.sea) return { cert: null, why: 'not-sea', detail: 'the kernel is not the signed SEA (npm install, a checkout or a dev run)' };
  if (!o.helper || !o.helper.alive) return { cert: null, why: 'no-helper', detail: 'no signed helper is running' };
  if (!versionAtLeast(o.helper.version, HELPER_OP_MIN['kernel.cert']!)) return { cert: null, why: 'helper-old', detail: `helper ${o.helper.version ?? '(unknown)'} is older than ${HELPER_OP_MIN['kernel.cert']}` };
  const boot = (o.boot ?? readBootSession)();
  if (normalizeBootId(boot) === 'unknown') return { cert: null, why: 'boot-unknown', detail: 'the boot session is unknown' };
  let reply: Record<string, unknown>;
  try {
    reply = await o.helper.request({ op: 'kernel.cert', kernelKeyId: o.signer.keyId, pub: o.signer.publicKeyPem, logId: o.logId });
  } catch (e) {
    return { cert: null, why: 'refused', detail: e instanceof Error ? e.message.slice(0, 200) : 'refused' };
  }
  const rec = { cert: reply.cert, sig: reply.sig, certKey: reply.certKey, certKeyId: reply.certKeyId } as KernelCertRecord;
  const why = kernelCertRefusal(rec, { kernelKeyId: o.signer.keyId, publicKeyPem: o.signer.publicKeyPem, boot, logId: o.logId, now: (o.now ?? Date.now)() });
  if (why) return { cert: null, why: 'bad-cert', detail: why };
  return { cert: rec, expiresAt: parseKernelCert(rec)!.expiresAt };
}

/* ── the seal ─────────────────────────────────────────────────────────── */

export interface SignedRow {
  row: Record<string, unknown>;
  signer: string;
  sig: string;
}

export interface KernelCustodyDoc {
  schemaVersion: typeof KERNEL_CUSTODY_DOC_SCHEMA;
  certKey: SignedRow;
  legacy: SignedRow;
  /** Aegis S2 M-4: EVERY sealed legacy key id, sorted; the root-signed legacy row carries their digest and count */
  legacyKeyIds: string[];
}

/** A verified seal: the registered cert key and the sealed legacy keys. */
export interface KernelSeal {
  certKey: string;
  certKeyId: string;
  legacyKeyIds: ReadonlySet<string>;
  logId: string;
  headSeq: number;
  headHash: string;
  cardId: string;
}

export type SealRead = { state: 'none' } | { state: 'sealed'; seal: KernelSeal } | { state: 'invalid'; why: string };

export function kernelCustodyPath(home: string): string {
  return path.join(keysDir(home), KERNEL_CUSTODY_FILE);
}

/** Is a seal file present at all (unverified)? Refusing an uncertified append on presence alone is the safe side. */
export function sealFilePresent(home: string): boolean {
  try {
    return fs.statSync(kernelCustodyPath(home)).isFile();
  } catch {
    return false;
  }
}

/** Read and verify the seal against the root (rows, signatures, row table, one card). */
export function readKernelSeal(home: string, root: { readonly rootKeyId: string | null; verifyRow(signer: string, row: unknown, sigB64: string): boolean }): SealRead {
  let text: string;
  try {
    text = fs.readFileSync(kernelCustodyPath(home), 'utf8');
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none' } : { state: 'invalid', why: 'the seal file is unreadable' };
  }
  let doc: KernelCustodyDoc;
  try {
    doc = JSON.parse(text) as KernelCustodyDoc;
  } catch {
    return { state: 'invalid', why: 'the seal file is not JSON' };
  }
  if (!doc || doc.schemaVersion !== KERNEL_CUSTODY_DOC_SCHEMA || !doc.certKey || !doc.legacy) return { state: 'invalid', why: 'not a gnomon-kernel-custody-doc:v1' };
  if (!root.rootKeyId) return { state: 'invalid', why: 'no root to verify the seal against' };
  for (const s of [doc.certKey, doc.legacy]) {
    if (!s || typeof s.signer !== 'string' || typeof s.sig !== 'string' || !s.row || typeof s.row !== 'object') return { state: 'invalid', why: 'a seal row is malformed' };
    if (s.signer !== root.rootKeyId || !root.verifyRow(s.signer, s.row, s.sig)) return { state: 'invalid', why: 'a seal row is not signed by the root' };
  }
  const k = doc.certKey.row;
  const l = doc.legacy.row;
  if (k.schemaVersion !== KERNEL_CERT_KEY_SCHEMA || l.schemaVersion !== KERNEL_LEGACY_SCHEMA) return { state: 'invalid', why: 'the seal rows are not a kernel-cert key row and a legacy row' };
  const why = kernelCustodyRefusal([k, l]);
  if (why) return { state: 'invalid', why };
  if (k.cardId !== l.cardId || typeof k.cardId !== 'string') return { state: 'invalid', why: 'the seal rows come from different decisions' };
  const ids = Array.isArray(doc.legacyKeyIds) && doc.legacyKeyIds.every((v) => typeof v === 'string' && /^gkey:v1:[0-9a-f]{64}$/.test(v)) ? doc.legacyKeyIds : null;
  if (!ids || ids.length !== l.keyCount || new Set(ids).size !== ids.length || legacyKeysDigest(ids) !== l.keysDigest) return { state: 'invalid', why: "the seal's key list is not the one the root signed (digest or count)" };
  return {
    state: 'sealed',
    seal: { certKey: k.certKey as string, certKeyId: k.certKeyId as string, legacyKeyIds: new Set(ids), logId: l.logId as string, headSeq: l.headSeq as number, headHash: l.headHash as string, cardId: k.cardId },
  };
}

/** Write the seal (0600, tmp + rename) from the migration card's root-signed rows. */
export function writeKernelSeal(home: string, certKey: SignedRow, legacy: SignedRow, legacyKeyIds: readonly string[]): void {
  ensureKeysDir(home);
  const file = kernelCustodyPath(home);
  const tmp = `${file}.tmp`;
  const doc: KernelCustodyDoc = { schemaVersion: KERNEL_CUSTODY_DOC_SCHEMA, certKey, legacy, legacyKeyIds: [...new Set(legacyKeyIds)].sort() };
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify(doc)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/**
 * The migration card's rows (createdAt is added at prepare): register `cert`'s key and seal EVERY legacy key by digest
 * (Aegis S2 M-4; never empty — a home whose only key is certified seals that key) and the log head. `keyIds` is the
 * sorted list the seal file keeps beside the rows.
 */
export function migrationRows(o: { cert: KernelCertRecord; legacyKeyIds: readonly string[]; currentKeyId: string; head: { log: string; seq: number; hash: string }; cardId: string }): { rows: [Record<string, unknown>, Record<string, unknown>]; keyIds: string[] } {
  const ids = [...new Set(o.legacyKeyIds)].sort();
  if (ids.length === 0) ids.push(o.currentKeyId);
  return {
    keyIds: ids,
    rows: [
      { schemaVersion: KERNEL_CERT_KEY_SCHEMA, certKey: o.cert.certKey, certKeyId: o.cert.certKeyId, cardId: o.cardId },
      { schemaVersion: KERNEL_LEGACY_SCHEMA, keysDigest: legacyKeysDigest(ids), keyCount: ids.length, logId: o.head.log, headSeq: o.head.seq, headHash: o.head.hash, cardId: o.cardId },
    ],
  };
}

/** The migration card's words (TD-2026-10-29-746): one clear, one-time move. */
export function migrationCardLines(o: { legacyKeys: number; certKeyId: string; sinceLastVerified?: number }): string[] {
  return [
    "Protect Gnomon's log with the helper (one time)",
    "From now on the signed Gnomon helper vouches for the kernel's key at every start, so nothing else on this Mac can sign log entries as Gnomon.",
    `This one Touch ID registers the helper's certifying key (${o.certKeyId.slice(7, 19)}) and seals the ${o.legacyKeys} kernel key${o.legacyKeys === 1 ? '' : 's'} Gnomon used before today.`,
    // Aegis S2 L-4: what was appended since the last start that verified, so a planted key is visible before the touch
    ...(o.sinceLastVerified !== undefined ? [`${o.sinceLastVerified} of them ${o.sinceLastVerified === 1 ? 'was' : 'were'} recorded since the last verified start.`] : []),
    'History from before today stays labelled partial. After this, only kernel keys the helper certified are trusted.',
    'Not now: Gnomon keeps working as today (custody partial) and asks again at the next start.',
  ];
}

/* ── custody state ────────────────────────────────────────────────────── */

export type KernelKeyCustody = 'full' | 'partial';

export interface KernelCustodyStatus {
  custody: KernelKeyCustody;
  cert: { state: 'valid'; certKeyId: string; expiresAt: string } | { state: 'none'; why: KernelCertMissing; detail?: string };
  seal: { state: 'none' | 'sealed' | 'invalid'; certKeyId?: string; why?: string; matchesCert?: boolean };
  /** the migration card while it is open */
  migration?: { cardId: string };
  /** why custody is partial (empty when full) */
  partialBecause: string[];
}

/** The custody verdict from its three inputs. */
export function custodyOf(cert: KernelCertResult, seal: SealRead, anchorQuarantined: boolean): Pick<KernelCustodyStatus, 'custody' | 'partialBecause'> {
  const because: string[] = [];
  if (!cert.cert) because.push(`no kernel cert (${cert.why ?? 'none'})`);
  if (seal.state !== 'sealed') because.push(seal.state === 'none' ? 'kernel-pub.jsonl is not sealed yet (the one-time card)' : `the seal does not verify (${seal.why})`);
  else if (cert.cert && seal.seal.certKey !== cert.cert.certKey) because.push('the cert is signed by another key than the registered kernel-cert key');
  if (anchorQuarantined) because.push('the log anchor is in quarantine');
  return { custody: because.length === 0 ? 'full' : 'partial', partialBecause: because };
}

/**
 * @symbol #identity
 *
 * #identity (spec §3.1 data model, I5) — `~/.gnomon/keys/registry.jsonl`, the
 * append-only, ROOT-signed key registry. Public material only.
 *
 *   line = { row, signer: <rootKeyId>, sig: base64 }   (sig: root key, domain gnomon:row-sig:v1)
 *   row  = { schemaVersion: 'registryRow:v1', kind: 'kernel' | 'device', keyId, publicKeyPem, createdAt,
 *            deviceId?, principalId?, principalKind? }            (device rows carry the last three)
 *
 * Reading is fail-closed (keys.ts:338-360 pattern): a line that does not parse,
 * a row whose signer is not THE root (the 8.0 trust set, I5), a bad signature,
 * a keyId that is not sha256 of its PEM, or a principal/device outside the
 * root's ns NEVER resolves and is surfaced in `rejected[]`. First row wins per
 * deviceId and per keyId (pin, keys.ts:28-32); a later conflicting row is
 * surfaced, never applied. Revocation rows (`key.device.revoked`) arrive with
 * M1.3's `gnomon key device revoke` — this slice has NO revocation.
 * `RegistryCache` re-resolves only when the file's size, mtime or sha256
 * changes (a same-size same-mtime rewrite is caught by the hash).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEVICE_ID_PATTERN, parsePrincipalId, PRINCIPAL_KINDS, type PrincipalKind } from '@a-company/gnomon-contracts';
import { ed25519KeyId } from '../log/signer.js';
import { ensureKeysDir, keysDir } from './device-key.js';
import type { RootAuthority } from './root-authority.js';

export const REGISTRY_FILE = 'registry.jsonl';
export const REGISTRY_ROW_SCHEMA = 'registryRow:v1' as const;

export interface RegistryRow {
  schemaVersion: typeof REGISTRY_ROW_SCHEMA;
  kind: 'kernel' | 'device';
  keyId: string;
  publicKeyPem: string;
  createdAt: string;
  deviceId?: string;
  principalId?: string;
  principalKind?: PrincipalKind;
}

export interface DeviceEntry {
  deviceId: string;
  principalId: string;
  principalKind: PrincipalKind;
  keyId: string;
  publicKeyPem: string;
}

export interface ResolvedRegistry {
  devices: Map<string, DeviceEntry>;
  kernelKeys: Map<string, string>; // keyId → PEM
  rejected: Array<{ line: number; reason: string }>;
}

/** Anything that verifies rows from the trust set (RootAuthority or a client's RootVerifier). */
export interface RowVerifier {
  readonly rootKeyId: string | null;
  readonly ns: string | null;
  verifyRow(signer: string, row: unknown, sigB64: string): boolean;
}

export function registryPath(home: string): string {
  return path.join(keysDir(home), REGISTRY_FILE);
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkRow(row: unknown, ns: string): string | null {
  if (!isObj(row) || row.schemaVersion !== REGISTRY_ROW_SCHEMA) return 'schema';
  if (row.kind !== 'kernel' && row.kind !== 'device') return 'kind';
  if (typeof row.publicKeyPem !== 'string' || typeof row.keyId !== 'string') return 'key';
  let derived: string;
  try {
    derived = ed25519KeyId(row.publicKeyPem);
  } catch {
    return 'key';
  }
  if (derived !== row.keyId) return 'keyId-mismatch';
  if (row.kind === 'device') {
    if (typeof row.deviceId !== 'string' || !DEVICE_ID_PATTERN.test(row.deviceId)) return 'deviceId';
    if (row.deviceId.slice(4, 12) !== ns) return 'deviceId-ns';
    const p = typeof row.principalId === 'string' ? parsePrincipalId(row.principalId) : undefined;
    if (!p || p.foreign || p.ns !== ns) return 'principal';
    if (!(PRINCIPAL_KINDS as readonly unknown[]).includes(row.principalKind)) return 'principalKind';
    // §4.9 / S32-01: peers are not clients; a kernel never authenticates as a device.
    if (row.principalKind === 'peer' || row.principalKind === 'kernel') return 'principalKind';
  }
  return null;
}

/** Read and resolve the registry against the trust set. Never throws on content. */
export function readRegistry(home: string, trust: RowVerifier): ResolvedRegistry {
  let text: string;
  try {
    text = fs.readFileSync(registryPath(home), 'utf8');
  } catch {
    text = '';
  }
  return resolveRegistryText(text, trust);
}

/** Resolve registry text (the exact bytes a caller read and hashed) against the trust set. */
export function resolveRegistryText(text: string, trust: RowVerifier): ResolvedRegistry {
  const out: ResolvedRegistry = { devices: new Map(), kernelKeys: new Map(), rejected: [] };
  const seenKeys = new Set<string>();
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
    const row = rec.row as unknown as RegistryRow;
    if (seenKeys.has(row.keyId)) {
      out.rejected.push({ line, reason: 'duplicate-key' });
      return;
    }
    if (row.kind === 'kernel') {
      seenKeys.add(row.keyId);
      out.kernelKeys.set(row.keyId, row.publicKeyPem);
      return;
    }
    if (out.devices.has(row.deviceId!)) {
      out.rejected.push({ line, reason: 'device-pinned' });
      return;
    }
    seenKeys.add(row.keyId);
    out.devices.set(row.deviceId!, {
      deviceId: row.deviceId!,
      principalId: row.principalId!,
      principalKind: row.principalKind!,
      keyId: row.keyId,
      publicKeyPem: row.publicKeyPem,
    });
  });
  return out;
}

function appendRow(home: string, authority: RootAuthority, row: RegistryRow): RegistryRow {
  const signed = authority.signRow(row); // throws RootUnavailableError (UNSUPPORTED, M1.3) without a root
  ensureKeysDir(home);
  const fd = fs.openSync(registryPath(home), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify({ row, ...signed })}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return row;
}

/** Register a device key under a principal of the root's ns (root-signed row). */
export function registerDevice(
  home: string,
  authority: RootAuthority,
  d: { host: string; name: string; principalKind?: PrincipalKind; publicKeyPem: string; now?: Date },
): DeviceEntry {
  if (authority.ns === null) authority.signRow(null); // refuses with the M1.3 refusal
  const ns = authority.ns!;
  const row: RegistryRow = {
    schemaVersion: REGISTRY_ROW_SCHEMA,
    kind: 'device',
    keyId: ed25519KeyId(d.publicKeyPem),
    publicKeyPem: d.publicKeyPem,
    createdAt: (d.now ?? new Date()).toISOString(),
    deviceId: `dev:${ns}/${d.host}`,
    principalId: `p:${ns}/${d.name}`,
    principalKind: d.principalKind ?? 'human',
  };
  const bad = checkRow(row, ns);
  if (bad) throw new TypeError(`#identity: refusing to register an invalid device row (${bad})`);
  appendRow(home, authority, row);
  return { deviceId: row.deviceId!, principalId: row.principalId!, principalKind: row.principalKind!, keyId: row.keyId, publicKeyPem: row.publicKeyPem };
}

/** Register the kernel key's public half (root-signed row; §3.1 "Its registry row … is root-signed"). */
export function registerKernelKey(home: string, authority: RootAuthority, publicKeyPem: string, now: Date = new Date()): string {
  const row: RegistryRow = {
    schemaVersion: REGISTRY_ROW_SCHEMA,
    kind: 'kernel',
    keyId: ed25519KeyId(publicKeyPem),
    publicKeyPem,
    createdAt: now.toISOString(),
  };
  appendRow(home, authority, row);
  return row.keyId;
}

/** Resolution cached by (size, mtimeMs) then sha256 of the bytes. */
export class RegistryCache {
  #key = '';
  #hash = '';
  #resolved: ResolvedRegistry | null = null;
  constructor(
    readonly home: string,
    readonly trust: RowVerifier,
  ) {}

  get(): ResolvedRegistry {
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(registryPath(this.home));
    } catch {
      st = null;
    }
    const key = st ? `${st.size}:${st.mtimeMs}:${st.ino}` : 'absent';
    if (this.#resolved && key === this.#key) return this.#resolved;
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(registryPath(this.home));
    } catch {
      bytes = Buffer.alloc(0);
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    this.#key = key;
    if (this.#resolved && hash === this.#hash) return this.#resolved;
    this.#hash = hash;
    this.#resolved = resolveRegistryText(bytes.toString('utf8'), this.trust); // parse the bytes that were hashed
    return this.#resolved;
  }
}

/**
 * @symbol #manifest-loader
 *
 * #manifest-loader grant table (spec §15.4) — `<home>/grants.jsonl`, the
 * append-only, ROOT-signed grant rows. Same custody and reader discipline as
 * the key registry (identity/registry.ts):
 *
 *   line = { row, signer: <rootKeyId>, sig }        (root key, domain gnomon:row-sig:v1)
 *   row  = { schemaVersion: 'grantRow:v1', kind: <GRANT_ROW_KINDS>, createdAt, …fields }
 *
 * Writing goes through the RootAuthority seam: until M1.3 the production
 * authority (UnprovisionedRootAuthority) refuses UNSUPPORTED{root-unprovisioned},
 * so production code can append NO grant row — nothing an install stages takes
 * effect. Reading is fail-closed: a line that does not parse, an untrusted
 * signer, a bad signature, an unknown kind, a malformed row, an egress row
 * naming an Anthropic host, or an egress row for a manifest that also holds
 * `knowledge:provide` never resolves and is surfaced in `rejected[]`.
 *
 * M1.5 consumes grant.capability / grant.trust / grant.egress / grant.install
 * / grant.bind. The other §15.4 kinds (grant.device, grant.voice,
 * grant.voice-approvals, grant.peer) are verified and kept in `other[]` for
 * their owners (M1.3, Move 4, M2.8). `grant.install` carries `name` in
 * addition to the §15.4 fields so the effective pin of a mod is a lookup, not
 * a scan of every snapshot directory (kernel-internal row; no client schema).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GRANT_ROW_KINDS, isPlainObject, type GrantRowKind } from '@a-company/gnomon-contracts';
import type { RootAuthority } from '../identity/root-authority.js';
import type { RowVerifier } from '../identity/registry.js';
import { checkEgressHost } from './egress.js';
import { capabilityForm, TRUST_TIER_PATTERN, type TrustTier } from './manifest.js';
import { ManifestRefusal } from './refusal.js';

export const GRANTS_FILE = 'grants.jsonl';
export const GRANT_ROW_SCHEMA = 'grantRow:v1' as const;
const SHA = /^sha256:[0-9a-f]{64}$/;
const CARD_ID = /^card:[0-9A-HJKMNP-TV-Z]{26}$/;

export interface GrantInstallRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.install';
  createdAt: string;
  name: string;
  manifestHash: string;
  packageHash: string;
  cardId: string;
  source: 'package' | `linked:${string}`;
  dev?: { until: string };
}
export interface GrantCapabilityRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.capability';
  createdAt: string;
  manifestHash?: string;
  deviceId?: string;
  capabilities: string[];
  read?: string[];
}
export interface GrantTrustRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.trust';
  createdAt: string;
  manifestHash: string;
  tier: TrustTier;
  maxKnowledgeTier?: string;
}
export interface GrantEgressRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.egress';
  createdAt: string;
  manifestHash: string;
  hosts: string[];
}
export interface GrantBindRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.bind';
  createdAt: string;
  principal: string;
  manifestHash: string;
  kinds: string[];
}
export type GrantRow = GrantInstallRow | GrantCapabilityRow | GrantTrustRow | GrantEgressRow | GrantBindRow;
/** What a writer passes: a grant row without schemaVersion (createdAt optional). */
export type GrantRowInput = GrantRow extends infer R ? (R extends GrantRow ? Omit<R, 'schemaVersion' | 'createdAt'> & { createdAt?: string } : never) : never;

export interface ResolvedGrants {
  capabilities: Map<string, { capabilities: Set<string>; read: string[] }>; // manifestHash → union
  trust: Map<string, TrustTier>; // manifestHash → tier (first row wins)
  egress: Map<string, Set<string>>; // manifestHash → hosts
  binds: GrantBindRow[];
  installs: GrantInstallRow[]; // file order
  other: Array<{ line: number; kind: GrantRowKind }>;
  rejected: Array<{ line: number; reason: string }>;
}

export function grantsPath(home: string): string {
  return path.join(home, GRANTS_FILE);
}

const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

/** Row-shape check; null = valid. Never consults other rows. */
export function checkGrantRow(row: unknown): string | null {
  if (!isPlainObject(row) || row.schemaVersion !== GRANT_ROW_SCHEMA) return 'schema';
  if (typeof row.kind !== 'string' || !(GRANT_ROW_KINDS as readonly string[]).includes(row.kind)) return 'kind';
  if (typeof row.createdAt !== 'string') return 'createdAt';
  switch (row.kind as GrantRowKind) {
    case 'grant.install': {
      if (typeof row.name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(row.name)) return 'name';
      if (typeof row.manifestHash !== 'string' || !SHA.test(row.manifestHash)) return 'manifestHash';
      if (typeof row.packageHash !== 'string' || !SHA.test(row.packageHash)) return 'packageHash';
      if (typeof row.cardId !== 'string' || !CARD_ID.test(row.cardId)) return 'cardId';
      if (row.source !== 'package' && !(typeof row.source === 'string' && /^linked:.+/.test(row.source))) return 'source';
      if (row.dev !== undefined && !(isPlainObject(row.dev) && typeof row.dev.until === 'string')) return 'dev';
      return null;
    }
    case 'grant.capability': {
      const subj = (typeof row.manifestHash === 'string' && SHA.test(row.manifestHash)) !== (typeof row.deviceId === 'string');
      if (!subj) return 'subject';
      if (!strArr(row.capabilities) || row.capabilities.length === 0) return 'capabilities';
      if (row.capabilities.some((c) => capabilityForm(c) === undefined)) return 'capability-form';
      if (row.read !== undefined) {
        if (!strArr(row.read)) return 'read';
        if (!row.capabilities.includes('knowledge:provide')) return 'read-without-knowledge';
      }
      return null;
    }
    case 'grant.trust':
      if (typeof row.manifestHash !== 'string' || !SHA.test(row.manifestHash)) return 'manifestHash';
      if (typeof row.tier !== 'string' || !TRUST_TIER_PATTERN.test(row.tier)) return 'tier';
      return null;
    case 'grant.egress':
      if (typeof row.manifestHash !== 'string' || !SHA.test(row.manifestHash)) return 'manifestHash';
      if (!strArr(row.hosts) || row.hosts.length === 0) return 'hosts';
      for (const h of row.hosts) {
        const v = checkEgressHost(h);
        if (!v.ok) return `egress-${v.why}`;
      }
      return null;
    case 'grant.bind':
      if (typeof row.principal !== 'string' || typeof row.manifestHash !== 'string' || !SHA.test(row.manifestHash)) return 'subject';
      if (!strArr(row.kinds)) return 'kinds';
      return null;
    default:
      return null; // grant.device / voice / voice-approvals / peer: verified signature, kept for their owners
  }
}

/** Read and resolve the grant table against the trust set. Never throws on content. */
export function readGrants(home: string, trust: RowVerifier): ResolvedGrants {
  let text = '';
  try {
    text = fs.readFileSync(grantsPath(home), 'utf8');
  } catch {
    text = '';
  }
  const out: ResolvedGrants = { capabilities: new Map(), trust: new Map(), egress: new Map(), binds: [], installs: [], other: [], rejected: [] };
  const egressLines = new Map<string, number[]>();
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
    if (!isPlainObject(rec) || typeof rec.signer !== 'string' || typeof rec.sig !== 'string') return void out.rejected.push({ line, reason: 'unsigned' });
    if (trust.rootKeyId === null) return void out.rejected.push({ line, reason: 'root-unprovisioned' });
    if (!trust.verifyRow(rec.signer, rec.row, rec.sig)) {
      return void out.rejected.push({ line, reason: rec.signer === trust.rootKeyId ? 'bad-signature' : 'untrusted-signer' });
    }
    const bad = checkGrantRow(rec.row);
    if (bad) return void out.rejected.push({ line, reason: bad });
    const row = rec.row as unknown as GrantRow | { kind: GrantRowKind };
    switch (row.kind) {
      case 'grant.install':
        out.installs.push(row as GrantInstallRow);
        break;
      case 'grant.capability': {
        const r = row as GrantCapabilityRow;
        const key = r.manifestHash ?? `device:${r.deviceId}`;
        const cur = out.capabilities.get(key) ?? { capabilities: new Set<string>(), read: [] };
        for (const c of r.capabilities) cur.capabilities.add(c);
        for (const p of r.read ?? []) if (!cur.read.includes(p)) cur.read.push(p);
        out.capabilities.set(key, cur);
        break;
      }
      case 'grant.trust': {
        const r = row as GrantTrustRow;
        if (!out.trust.has(r.manifestHash)) out.trust.set(r.manifestHash, r.tier);
        break;
      }
      case 'grant.egress': {
        const r = row as GrantEgressRow;
        const cur = out.egress.get(r.manifestHash) ?? new Set<string>();
        for (const h of r.hosts) cur.add(checkEgressHost(h).host);
        out.egress.set(r.manifestHash, cur);
        egressLines.set(r.manifestHash, [...(egressLines.get(r.manifestHash) ?? []), line]);
        break;
      }
      case 'grant.bind':
        out.binds.push(row as GrantBindRow);
        break;
      default:
        out.other.push({ line, kind: row.kind });
    }
  });
  // never egress together with knowledge:provide (§15.4): fail closed — drop the egress, surface the rows
  for (const [mh, lines] of egressLines) {
    if (out.capabilities.get(mh)?.capabilities.has('knowledge:provide')) {
      out.egress.delete(mh);
      for (const line of lines) out.rejected.push({ line, reason: 'egress-with-knowledge' });
    }
  }
  out.rejected.sort((a, b) => a.line - b.line);
  return out;
}

/**
 * Append one root-signed grant row. The row is validated first (an Anthropic
 * egress host or a knowledge+egress pairing is refused before signing), then
 * signed by the authority — which refuses UNSUPPORTED until M1.3 in production.
 */
export function appendGrantRow(home: string, authority: RootAuthority, input: GrantRowInput, now: Date = new Date()): GrantRow {
  const row = { schemaVersion: GRANT_ROW_SCHEMA, createdAt: input.createdAt ?? now.toISOString(), ...input } as GrantRow;
  const bad = checkGrantRow(row);
  if (bad) {
    throw new ManifestRefusal(bad.startsWith('egress') ? 'EGRESS' : 'GRANT', `refusing to sign an invalid ${String(row.kind)} row (${bad})`, { rowCheck: bad });
  }
  if (row.kind === 'grant.egress' || (row.kind === 'grant.capability' && row.manifestHash && row.capabilities.includes('knowledge:provide'))) {
    const mh = row.manifestHash!;
    const g = readGrants(home, authority);
    const clash = row.kind === 'grant.egress' ? g.capabilities.get(mh)?.capabilities.has('knowledge:provide') : g.egress.has(mh);
    if (clash) throw new ManifestRefusal('EGRESS', 'egress is never granted together with knowledge:provide (§15.4)', { manifestHash: mh });
  }
  const signed = authority.signRow(row); // RootUnavailableError (UNSUPPORTED, M1.3) in production
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(grantsPath(home), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND, 0o600);
  try {
    fs.writeSync(fd, `${JSON.stringify({ row, ...signed })}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return row;
}

export interface GrantCheck {
  ok: boolean;
  missingCapabilities: string[];
  missingEgress: string[];
  tier: TrustTier | undefined;
  read: string[];
}

/** Does the grant table hold every capability and egress host the manifest requires? */
export function checkAgainstGrants(
  manifest: { requires?: { capabilities?: string[]; egress?: 'none' | Array<{ host: string }> } },
  mh: string,
  grants: ResolvedGrants,
): GrantCheck {
  const held = grants.capabilities.get(mh)?.capabilities ?? new Set<string>();
  const hosts = grants.egress.get(mh) ?? new Set<string>();
  const missingCapabilities = (manifest.requires?.capabilities ?? []).filter((c) => !held.has(c));
  const eg = manifest.requires?.egress;
  const missingEgress = Array.isArray(eg) ? eg.map((e) => checkEgressHost(e.host).host).filter((h) => !hosts.has(h)) : [];
  return {
    ok: missingCapabilities.length === 0 && missingEgress.length === 0,
    missingCapabilities,
    missingEgress,
    tier: grants.trust.get(mh),
    read: grants.capabilities.get(mh)?.read ?? [],
  };
}

/** The effective install of a mod: the LAST grant.install row naming it (re-pins and rollbacks append). */
export function effectiveInstall(grants: ResolvedGrants, name: string): GrantInstallRow | undefined {
  for (let i = grants.installs.length - 1; i >= 0; i--) if (grants.installs[i]!.name === name) return grants.installs[i];
  return undefined;
}

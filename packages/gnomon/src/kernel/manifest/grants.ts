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
 *
 * S0b (mod ids): grant.install / grant.uninstall / grant.publisher are written as `grantRow:v2` rows whose `name` is
 * the FULL mod id `<publisher>.<name>`; every other kind stays `grantRow:v1` (keyed by manifestHash). An older kernel
 * fails closed on a v2 row (its reader refuses the unknown schemaVersion: the mod simply does not load there).
 * Legacy `grantRow:v1` install/uninstall rows (a bare name) are resolved at READ time, never rewritten, through the
 * frozen alias table: `gnomon.<N>` only when N is one of LEGACY_ALIASES AND the row's grant.trust tier is first-party
 * AND its packageHash is a historical first-party pin; anything else is `local.<N>`. The resolved row keeps the bare
 * name as `legacyName` (its snapshot directory, pinDirKey). grant.publisher{publisher, host, namespace} is the TOFU
 * binding of a non-GitHub publisher (the last row per publisher wins).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { GRANT_ROW_KINDS, isModId, isPlainObject, MANIFEST_FORMAT, parseGitSource, PUBLISHER_PATTERN, type GrantRowKind } from '@a-company/gnomon-contracts';
import type { RootAuthority } from '../identity/root-authority.js';
import type { RowVerifier } from '../identity/registry.js';
import { checkEgressHost } from './egress.js';
import { LEGACY_ALIASES } from './mod-kind.js';
import { capabilityForm, TRUST_TIER_PATTERN, type TrustTier } from './manifest.js';
import { ManifestRefusal } from './refusal.js';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { appendLinesDurably, withHomeFileLock } from './grant-lock.js';

export const GRANTS_FILE = 'grants.jsonl';
export const GRANT_ROW_SCHEMA = 'grantRow:v1' as const;
/** S0b: the row schema of grant.install / grant.uninstall / grant.publisher (full mod ids). */
export const GRANT_ROW_SCHEMA_V2 = 'grantRow:v2' as const;
const V2_KINDS: readonly string[] = Object.freeze(['grant.install', 'grant.uninstall', 'grant.publisher']);
const LEGACY_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export { LEGACY_ALIASES, ownsModKind } from './mod-kind.js';
/** packageHashes of the historical (format-1) first-party pins: an alias resolves to gnomon.<N> only from one of these. */
export const HISTORICAL_FIRST_PARTY_PINS: ReadonlySet<string> = new Set<string>([
  'sha256:3c09d9cb5d22c3e75773baf547456bc4b2a2b0bebdaff9d67baaad159ff06e1d', // workshop 1.0.0
  'sha256:e840fb3902df137f280313d768e1cb1087a80eccfa78e0289ebacf52c1c43e83', // ledger 1.0.0
  'sha256:be0cce015b2db126206973adddd899060b6a3e6ff28fd7e53d5d0842530cfd71', // paradigm-context 1.0.0
]);
/** Is format 1 still loadable (MANIFEST_FORMAT.accepted)? The alias table is only meaningful while it is. */
export const FORMAT_1_SUPPORTED: boolean = MANIFEST_FORMAT.accepted.includes(1);

/** The alias of a legacy bare name (S0b §4): the full mod id it resolves to. */
export function aliasOf(legacyName: string, tier: TrustTier | undefined, packageHash: string): string {
  return LEGACY_ALIASES.includes(legacyName) && tier === 'first-party' && HISTORICAL_FIRST_PARTY_PINS.has(packageHash) ? `gnomon.${legacyName}` : `local.${legacyName}`;
}

/** The snapshot directory key of a pin row: the legacy bare name for a resolved v1 row, else the mod id. */
export function pinDirKey(row: { name: string; legacyName?: string }): string {
  return row.legacyName ?? row.name;
}
const SHA = /^sha256:[0-9a-f]{64}$/;
const CARD_ID = /^card:[0-9A-HJKMNP-TV-Z]{26}$/;

export interface GrantInstallRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA | typeof GRANT_ROW_SCHEMA_V2;
  kind: 'grant.install';
  createdAt: string;
  /** the full mod id (v2 rows; a resolved v1 row carries its alias here) */
  name: string;
  /** a resolved v1 row only: the bare legacy name (never written) */
  legacyName?: string;
  manifestHash: string;
  packageHash: string;
  cardId: string;
  source: 'package' | `linked:${string}` | `git:${string}`;
  /** a format-1 manifest: canonicalManifestHash of its upgraded V2 object (a mismatch at load re-cards) */
  upgradedHash?: string;
  dev?: { until: string };
}
/** S0b: the TOFU binding of a non-GitHub publisher to (host, namespace). */
export interface GrantPublisherRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA_V2;
  kind: 'grant.publisher';
  createdAt: string;
  /** TD-2026-10-20-514 (Aegis Q1): the card whose decision wrote it; REQUIRED on rows written through decision.sign */
  cardId?: string;
  publisher: string;
  host: string;
  namespace: string;
}
export interface GrantCapabilityRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.capability';
  createdAt: string;
  /** TD-2026-10-20-514 (Aegis Q1): the card whose decision wrote it; REQUIRED on rows written through decision.sign */
  cardId?: string;
  manifestHash?: string;
  deviceId?: string;
  capabilities: string[];
  read?: string[];
}
export interface GrantTrustRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.trust';
  createdAt: string;
  /** TD-2026-10-20-514 (Aegis Q1): the card whose decision wrote it; REQUIRED on rows written through decision.sign */
  cardId?: string;
  manifestHash: string;
  tier: TrustTier;
  maxKnowledgeTier?: string;
}
export interface GrantEgressRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.egress';
  createdAt: string;
  /** TD-2026-10-20-514 (Aegis Q1): the card whose decision wrote it; REQUIRED on rows written through decision.sign */
  cardId?: string;
  manifestHash: string;
  hosts: string[];
}
export interface GrantBindRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA;
  kind: 'grant.bind';
  createdAt: string;
  /** TD-2026-10-20-514 (Aegis Q1): the card whose decision wrote it; REQUIRED on rows written through decision.sign */
  cardId?: string;
  principal: string;
  manifestHash: string;
  kinds: string[];
}
/** M1.11 slice 3: a root-signed uninstall (decided on a root-class card); the effective pin is the LAST install/uninstall row naming the mod. */
export interface GrantUninstallRow {
  schemaVersion: typeof GRANT_ROW_SCHEMA | typeof GRANT_ROW_SCHEMA_V2;
  kind: 'grant.uninstall';
  createdAt: string;
  name: string;
  legacyName?: string;
  /** the pin it removes */
  packageHash: string;
  cardId: string;
}
export type GrantRow = GrantInstallRow | GrantCapabilityRow | GrantTrustRow | GrantEgressRow | GrantBindRow | GrantUninstallRow | GrantPublisherRow;
/** What a writer passes: a grant row without schemaVersion (createdAt optional). */
export type GrantRowInput = GrantRow extends infer R ? (R extends GrantRow ? Omit<R, 'schemaVersion' | 'createdAt'> & { createdAt?: string } : never) : never;

export interface ResolvedGrants {
  capabilities: Map<string, { capabilities: Set<string>; read: string[] }>; // manifestHash → union
  trust: Map<string, TrustTier>; // manifestHash → tier (first row wins)
  egress: Map<string, Set<string>>; // manifestHash → hosts
  binds: GrantBindRow[];
  installs: GrantInstallRow[]; // file order
  /** grant.install and grant.uninstall rows in file order (effectiveInstall reads this) */
  pins: Array<GrantInstallRow | GrantUninstallRow>;
  /** S0b: publisher → its TOFU (host, namespace) binding (last row wins) */
  /** publisher → its newest accepted binding (Aegis S0b M6: per-publisher strictly increasing createdAt) */
  publishers: Map<string, { host: string; namespace: string; createdAt?: string }>;
  other: Array<{ line: number; kind: GrantRowKind }>;
  rejected: Array<{ line: number; reason: string }>;
}

export function grantsPath(home: string): string {
  return path.join(home, GRANTS_FILE);
}

const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);

/** Row-shape check; null = valid. Never consults other rows. */
export function checkGrantRow(row: unknown): string | null {
  if (!isPlainObject(row) || (row.schemaVersion !== GRANT_ROW_SCHEMA && row.schemaVersion !== GRANT_ROW_SCHEMA_V2)) return 'schema';
  if (typeof row.kind !== 'string' || !(GRANT_ROW_KINDS as readonly string[]).includes(row.kind)) return 'kind';
  const v2 = row.schemaVersion === GRANT_ROW_SCHEMA_V2;
  // S0b: v2 only for the id-carrying kinds; grant.publisher only as v2
  if (v2 !== V2_KINDS.includes(row.kind) && !(row.schemaVersion === GRANT_ROW_SCHEMA && (row.kind === 'grant.install' || row.kind === 'grant.uninstall'))) return 'schema';
  if (typeof row.createdAt !== 'string') return 'createdAt';
  // TD-2026-10-20-514 (Aegis Q1): a cardId, when present, is a card id (pin rows require it below)
  if (row.cardId !== undefined && (typeof row.cardId !== 'string' || !CARD_ID.test(row.cardId))) return 'cardId';
  const nameOk = (n: unknown) => typeof n === 'string' && (v2 ? isModId(n) : LEGACY_NAME.test(n));
  switch (row.kind as GrantRowKind) {
    case 'grant.install': {
      if (!nameOk(row.name)) return 'name';
      if (typeof row.manifestHash !== 'string' || !SHA.test(row.manifestHash)) return 'manifestHash';
      if (typeof row.packageHash !== 'string' || !SHA.test(row.packageHash)) return 'packageHash';
      if (typeof row.cardId !== 'string' || !CARD_ID.test(row.cardId)) return 'cardId';
      const gitOk = v2 && typeof row.source === 'string' && parseGitSource(row.source) !== null;
      if (row.source !== 'package' && !(typeof row.source === 'string' && /^linked:.+/.test(row.source)) && !gitOk) return 'source';
      if (row.upgradedHash !== undefined && !(v2 && typeof row.upgradedHash === 'string' && SHA.test(row.upgradedHash))) return 'upgradedHash';
      if (row.dev !== undefined && !(isPlainObject(row.dev) && typeof row.dev.until === 'string')) return 'dev';
      return null;
    }
    case 'grant.publisher':
      if (typeof row.publisher !== 'string' || !PUBLISHER_PATTERN.test(row.publisher)) return 'publisher';
      if (typeof row.host !== 'string' || !/^[a-z0-9.-]{1,253}$/.test(row.host)) return 'host';
      // Aegis S0b M4: a github.com binding (written by a re-bind back to GitHub) names the owner, which is the publisher
      if (row.host === 'github.com' && row.namespace !== row.publisher) return 'host';
      if (typeof row.namespace !== 'string' || !/^[a-z0-9._/-]{1,512}$/.test(row.namespace)) return 'namespace';
      return null;
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
    case 'grant.uninstall':
      if (!nameOk(row.name)) return 'name';
      if (typeof row.packageHash !== 'string' || !SHA.test(row.packageHash)) return 'packageHash';
      if (typeof row.cardId !== 'string' || !CARD_ID.test(row.cardId)) return 'cardId';
      return null;
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
  const out: ResolvedGrants = { capabilities: new Map(), trust: new Map(), egress: new Map(), binds: [], installs: [], pins: [], publishers: new Map(), other: [], rejected: [] };
  // pin rows are resolved after every line is read: a legacy name's alias needs the grant.trust tier (S0b)
  const pinLines: Array<{ line: number; row: GrantInstallRow | GrantUninstallRow }> = [];
  const egressLines = new Map<string, number[]>();
  // Aegis C1 (M1.11 slice 3): a pin row (install/uninstall) whose createdAt is not later than the newest pin
  // row already seen for that name is a REPLAY (an old row re-appended) and never resolves. Rollback and
  // re-pins sign a fresh createdAt, so they still apply. Deleting a line is the residual (§15.1 row 30).
  const newestPin = new Map<string, number>();
  const replayed = (r: { name: string; createdAt: string }): boolean => {
    const t = Date.parse(r.createdAt);
    const prev = newestPin.get(r.name);
    if (!Number.isFinite(t) || (prev !== undefined && t <= prev)) return true;
    newestPin.set(r.name, t);
    return false;
  };
  // Aegis C5b (TD-2026-10-20-514): a supporting row carrying a cardId takes effect only when its batch's anchor (a
  // verified grant.install / grant.uninstall naming the same cardId) is present LATER in the file: a batch cut short
  // (crash, torn write, deleted tail) grants nothing. Pre-pass: the last line of each cardId's verified pin row.
  const anchorLine = new Map<string, number>();
  const lines = text.split('\n');
  lines.forEach((raw, i) => {
    if (raw.trim() === '' || trust.rootKeyId === null) return;
    try {
      const rec = JSON.parse(raw) as { row?: Record<string, unknown>; signer?: unknown; sig?: unknown };
      const row = rec?.row;
      if (!row || (row.kind !== 'grant.install' && row.kind !== 'grant.uninstall') || typeof row.cardId !== 'string') return;
      if (typeof rec.signer !== 'string' || typeof rec.sig !== 'string' || !trust.verifyRow(rec.signer, row, rec.sig) || checkGrantRow(row)) return;
      anchorLine.set(row.cardId, i + 1);
    } catch {
      /* rejected in the main pass */
    }
  });
  lines.forEach((raw, i) => {
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
    const cid = (rec.row as { cardId?: unknown }).cardId;
    if (row.kind !== 'grant.install' && row.kind !== 'grant.uninstall' && typeof cid === 'string' && !((anchorLine.get(cid) ?? 0) > line)) {
      return void out.rejected.push({ line, reason: 'unanchored' });
    }
    switch (row.kind) {
      case 'grant.install':
      case 'grant.uninstall':
        pinLines.push({ line, row: { ...(row as GrantInstallRow | GrantUninstallRow) } });
        break;
      case 'grant.publisher': {
        const r = row as GrantPublisherRow;
        // Aegis S0b M6: like pin rows, a binding not newer than the newest accepted one for that publisher is a replay
        const t = Date.parse(r.createdAt);
        const prev = out.publishers.get(r.publisher)?.createdAt;
        if (!Number.isFinite(t) || (prev !== undefined && t <= Date.parse(prev))) return void out.rejected.push({ line, reason: 'replay' });
        out.publishers.set(r.publisher, { host: r.host, namespace: r.namespace, createdAt: r.createdAt });
        break;
      }
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
  // S0b: resolve legacy bare names through the frozen alias table, then the replay rule on the resolved ids
  const legacyIds = new Map<string, string>(); // legacy name → id of its newest resolved install row
  for (const { line, row } of pinLines) {
    if (row.schemaVersion === GRANT_ROW_SCHEMA) {
      const bare = row.name;
      const id = row.kind === 'grant.install' ? aliasOf(bare, out.trust.get(row.manifestHash), row.packageHash) : (legacyIds.get(bare) ?? `local.${bare}`);
      if (row.kind === 'grant.install') legacyIds.set(bare, id);
      row.name = id;
      row.legacyName = bare;
    }
    if (replayed(row)) {
      out.rejected.push({ line, reason: 'replay' });
      continue;
    }
    if (row.kind === 'grant.install') out.installs.push(row);
    out.pins.push(row);
  }
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
/** The newest accepted pin row's createdAt (ms) for a mod, by the reader's own rule (accepted pins are strictly increasing). */
export function newestPinMs(grants: ResolvedGrants, name: string): number | undefined {
  let newest: number | undefined;
  for (const r of grants.pins) {
    if (r.name !== name) continue;
    const t = Date.parse(r.createdAt);
    if (newest === undefined || t > newest) newest = t;
  }
  return newest;
}

const isPin = (r: GrantRow): r is GrantInstallRow | GrantUninstallRow => r.kind === 'grant.install' || r.kind === 'grant.uninstall';

/**
 * TD-2026-10-20-514: build ONE grant row (schemaVersion, createdAt, the replay-safe createdAt bumps and the
 * knowledge+egress clash) against the table AND the rows already pending in the same batch. Pure: no signing, no
 * write. A row built here, signed, then rebuilt under the lock must come out identical, or the table moved.
 */
export function buildGrantRow(home: string, authority: RowVerifier, input: GrantRowInput, now: Date = new Date(), pending: readonly GrantRow[] = [], table?: ResolvedGrants): GrantRow {
  const g = table ?? readGrants(home, authority);
  // S0b: id-carrying kinds are v2 rows with the full mod id; never write a resolved row's legacyName
  const { legacyName: _legacy, schemaVersion: _sv, ...rest } = input as GrantRowInput & { legacyName?: string; schemaVersion?: string };
  const row = { schemaVersion: V2_KINDS.includes(input.kind) ? GRANT_ROW_SCHEMA_V2 : GRANT_ROW_SCHEMA, ...rest, createdAt: input.createdAt ?? now.toISOString() } as GrantRow;
  if (isPin(row)) {
    // Aegis round 3: the reader rejects a pin row not newer than the last one for that mod (replay, C1): createdAt is
    // max(now, newest + 1 ms) by the reader's exact rule, over the table and this batch
    let newest = newestPinMs(g, row.name);
    for (const p of pending) if (isPin(p) && p.name === row.name) newest = Math.max(newest ?? -Infinity, Date.parse(p.createdAt));
    const t = Date.parse(row.createdAt);
    if (newest !== undefined && !(Number.isFinite(t) && t > newest)) row.createdAt = new Date(newest + 1).toISOString();
  }
  if (row.kind === 'grant.publisher') {
    // Aegis S0b M6: the reader keeps only a strictly newer binding per publisher; never sign one it would reject
    let prev = g.publishers.get(row.publisher)?.createdAt;
    for (const p of pending) if (p.kind === 'grant.publisher' && p.publisher === row.publisher && (prev === undefined || Date.parse(p.createdAt) > Date.parse(prev))) prev = p.createdAt;
    const t = Date.parse(row.createdAt);
    if (prev !== undefined && !(Number.isFinite(t) && t > Date.parse(prev))) row.createdAt = new Date(Date.parse(prev) + 1).toISOString();
  }
  const bad = checkGrantRow(row);
  if (bad) {
    throw new ManifestRefusal(bad.startsWith('egress') ? 'EGRESS' : 'GRANT', `refusing to sign an invalid ${String(row.kind)} row (${bad})`, { rowCheck: bad });
  }
  if (row.kind === 'grant.egress' || (row.kind === 'grant.capability' && row.manifestHash && row.capabilities.includes('knowledge:provide'))) {
    const mh = row.manifestHash!;
    const knowledge = g.capabilities.get(mh)?.capabilities.has('knowledge:provide') || pending.some((p) => p.kind === 'grant.capability' && p.manifestHash === mh && p.capabilities.includes('knowledge:provide'));
    const egress = g.egress.has(mh) || pending.some((p) => p.kind === 'grant.egress' && p.manifestHash === mh);
    if (row.kind === 'grant.egress' ? knowledge : egress) throw new ManifestRefusal('EGRESS', 'egress is never granted together with knowledge:provide (§15.4)', { manifestHash: mh });
  }
  return row;
}

/** Build every row of one batch in order (each sees the ones before it). */
export function buildGrantRows(home: string, authority: RowVerifier, inputs: readonly GrantRowInput[], now: Date = new Date()): GrantRow[] {
  const g = readGrants(home, authority);
  const out: GrantRow[] = [];
  for (const i of inputs) out.push(buildGrantRow(home, authority, i, now, out, g));
  return out;
}

/**
 * TD-2026-10-20-514 / Aegis C5: append rows that are ALREADY root-signed. Every signature is verified; then, under the
 * cross-process file lock, every row is rebuilt against the table as it is NOW and must come out byte-identical (a
 * row whose createdAt went stale, a concurrent pin or binding, a new knowledge/egress clash: refused, nothing is
 * written and nothing is silently re-signed). ONE write + fsync, grant.install LAST, then the pin read-back.
 */
export function appendSignedGrantRows(home: string, authority: RowVerifier, rows: readonly GrantRow[], sigs: ReadonlyArray<{ signer: string; sig: string }>): void {
  if (rows.length === 0) return;
  if (rows.length !== sigs.length) throw new ManifestRefusal('GRANT', 'every grant row needs exactly one signature', {});
  rows.forEach((row, i) => {
    if (!authority.verifyRow(sigs[i]!.signer, row, sigs[i]!.sig)) throw new ManifestRefusal('GRANT', `the ${String(row.kind)} row's root signature does not verify`, { kind: row.kind });
  });
  const at = rows.findIndex((r) => r.kind === 'grant.install');
  if (at >= 0 && at !== rows.length - 1) throw new ManifestRefusal('GRANT', 'grant.install is written LAST', {});
  withHomeFileLock(home, 'grants', () => {
    const g = readGrants(home, authority);
    const pending: GrantRow[] = [];
    for (const row of rows) {
      let again: GrantRow;
      try {
        again = buildGrantRow(home, authority, row as unknown as GrantRowInput, new Date(row.createdAt), pending, g);
      } catch (e) {
        throw e instanceof ManifestRefusal ? new ManifestRefusal(e.manifestCode, `the grant table moved since this decision was signed: ${e.message}; nothing was written, decide again`, { stale: true }) : e;
      }
      if (canonicalJson(again) !== canonicalJson(row)) throw new ManifestRefusal('GRANT', `the grant table moved since this decision was signed (the ${String(row.kind)} row is stale); nothing was written, decide again`, { stale: true, kind: row.kind });
      pending.push(row);
    }
    appendLinesDurably(grantsPath(home), rows.map((row, i) => JSON.stringify({ row, ...sigs[i] })));
    const after = readGrants(home, authority);
    for (const row of rows) {
      if (!isPin(row)) continue;
      // the pin must be the effective one now, or the caller must not act as if it were
      const last = after.pins.filter((r) => r.name === row.name).at(-1);
      if (!last || last.kind !== row.kind || last.createdAt !== row.createdAt || last.cardId !== row.cardId || last.packageHash !== row.packageHash) {
        throw new ManifestRefusal('GRANT', `the ${row.kind} row for ${row.name} did not take effect (the grant reader did not resolve it as the effective pin)`, { name: row.name });
      }
    }
  });
}

/**
 * Append one root-signed grant row (the CLI path; the daemon's card decisions go through buildGrantRows +
 * decision.sign + appendSignedGrantRows). Built, signed by the authority (RootUnavailableError without a root),
 * then re-checked and written under the same lock as the batch path.
 */
export function appendGrantRow(home: string, authority: RootAuthority, input: GrantRowInput, now: Date = new Date()): GrantRow {
  const row = buildGrantRow(home, authority, input, now);
  const signed = authority.signRow(row); // RootUnavailableError (UNSUPPORTED, M1.3) in production
  appendSignedGrantRows(home, authority, [row], [signed]);
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

/** The effective install of a mod: the LAST grant.install row naming it (re-pins and rollbacks append), unless a later grant.uninstall names it. */
export function effectiveInstall(grants: ResolvedGrants, name: string): GrantInstallRow | undefined {
  const pins = grants.pins ?? grants.installs;
  for (let i = pins.length - 1; i >= 0; i--) {
    const r = pins[i]!;
    if (r.name === name) return r.kind === 'grant.install' ? r : undefined;
  }
  return undefined;
}

/**
 * #keys — M3-lite I1 (m3-integrity-design-2026-08-23.md §6 rulings over §3):
 * Ed25519 agent signing keys for the strand-signature epoch. `node:crypto` only,
 * NO external deps, NO passphrase/scrypt/AES, NO root key, NO git witness —
 * the human boundary is PROCEDURAL (HUMAN_ONLY_VERBS + tool-permission denies,
 * founder ruling TD-2026-08-23-136 Q1/Q2).
 *
 * WHAT A KEY SIGNS (I3, Build B): the pickId, domain-separated —
 * `Ed25519(key, 'warpline:strand-sig:v1\n' + pickId)`. The pickId already
 * commits to parents, actor, delta, bytes and `resolves` (strand.ts v2/v3
 * preimages), so signing it inherits all of it; post-seal-mutable fields stay
 * correctly outside. This module ships the primitives; the seal path is
 * untouched until I3.
 *
 * KEY IDENTITY: keyId = 'wlkey:v1:' + sha256 over the EXACT PEM bytes node
 * exports for the public key (spki/pem), with the trailing newline(s) trimmed —
 * that normalized string is ALSO what the key file and registry store, so the
 * id and the stored material can never disagree about which bytes were hashed.
 *
 * STORAGE (mirrors #warplined-tokens custody):
 *   - `.warpline/keys/agents/<principal>.key` — agentKey:v1 JSON, file 0600,
 *     dirs 0700. Holds the PRIVATE key: honestly weak within the OS-user
 *     boundary (any same-user process can read it), real across it — exactly
 *     the daemon-token trust claim, stated rather than implied.
 *   - `.warpline/keys/registry.jsonl` — append-only keyRegistry:v1 rows.
 *     `agent-key` rows carry PUBLIC material only; re-mint = append, LATEST row
 *     wins (token re-mint semantics — rotation without a revocation ceremony).
 *     ONE `signed-from` row pins the signing-epoch boundary: the fabric tip
 *     pickId at first mint. The FIRST such row is authoritative FOREVER and
 *     later ones are ignored, because a movable boundary would let anyone
 *     un-sign history — append a later "boundary" and every strand before it
 *     becomes grandfathered-unsigned again. Pin once, like the v1 anchor.
 *
 * FAIL-CLOSED (tokens.ts posture): a key file that is missing parses to null;
 * one that is garbled/wrong-schema ALSO parses to null (never a throw a caller
 * might soften into a default); a garbled registry row is skipped AND surfaced
 * in a diagnostics list — it must never resolve to a usable key. The strict
 * loader variant throws precise messages for CLI surfaces only.
 *
 * Library code: no console output.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as ed25519Sign,
  verify as ed25519Verify,
} from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf, readFabric } from './fabric.js';
import { readRef } from './refs.js';

export const AGENT_KEY_SCHEMA = 'agentKey:v1' as const;
export const KEY_REGISTRY_SCHEMA = 'keyRegistry:v1' as const;
export const KEY_ID_PREFIX = 'wlkey:v1:' as const;

/**
 * The signature domain prefix (I3's preimage = this + the pickId, utf8).
 * Domain separation: a signature over any other Warpline artifact — or over a
 * pickId under a different protocol version — can never verify here.
 */
export const STRAND_SIG_DOMAIN = 'warpline:strand-sig:v1\n' as const;

/**
 * Legal principal names: single path segment, no traversal — the name is
 * spliced into `.warpline/keys/agents/<principal>.key` (same fail-closed
 * grammar #fabric-refs applies to ref names, for the same reason: an
 * unvalidated `../…` would escape .warpline/ as a WRITE).
 */
const PRINCIPAL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isPrincipalName(name: string): boolean {
  return PRINCIPAL_NAME.test(name) && !name.includes('..');
}

function assertPrincipalName(name: string): void {
  if (!isPrincipalName(name)) {
    throw new Error(
      `warpline: illegal principal name "${name}" — a principal is a single path segment ` +
        `([A-Za-z0-9][A-Za-z0-9._-]*, no ".."); it is spliced into .warpline/keys/agents/, ` +
        `so traversal is refused fail-closed`,
    );
  }
}

/* ── paths ──────────────────────────────────────────────────────────────────── */

export function keysDirOf(root: string): string {
  return path.join(warplineDirOf(root), 'keys');
}

export function agentKeysDirOf(root: string): string {
  return path.join(keysDirOf(root), 'agents');
}

export function agentKeyPathOf(root: string, principal: string): string {
  assertPrincipalName(principal);
  return path.join(agentKeysDirOf(root), `${principal}.key`);
}

export function keyRegistryPathOf(root: string): string {
  return path.join(keysDirOf(root), 'registry.jsonl');
}

/* ── key generation + the domain-separated signature primitive ─────────────── */

export interface GeneratedAgentKey {
  publicKeyPem: string;
  privateKeyPem: string;
  keyId: string;
}

/**
 * Normalize a PEM deterministically: the exact bytes node exports, with
 * trailing newline(s) trimmed. The keyId is computed over THESE bytes — the
 * same normalized string is what gets stored, so recomputing the id from any
 * stored copy reproduces it.
 */
function normalizePem(pem: string): string {
  return pem.replace(/\n+$/, '');
}

/** keyId = 'wlkey:v1:' + sha256(normalized public-key PEM, utf8), hex. */
export function computeKeyId(publicKeyPem: string): string {
  return KEY_ID_PREFIX + createHash('sha256').update(normalizePem(publicKeyPem), 'utf8').digest('hex');
}

/** Generate a fresh Ed25519 keypair (node:crypto; no external deps). */
export function generateAgentKey(): GeneratedAgentKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = normalizePem(publicKey.export({ type: 'spki', format: 'pem' }).toString());
  const privateKeyPem = normalizePem(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
  return { publicKeyPem, privateKeyPem, keyId: computeKeyId(publicKeyPem) };
}

/**
 * Sign a pickId, domain-separated: preimage is EXACTLY
 * `'warpline:strand-sig:v1\n' + pickId` (utf8). Returns base64.
 */
export function signPickId(privateKeyPem: string, pickId: string): string {
  const key = createPrivateKey(privateKeyPem);
  return ed25519Sign(null, Buffer.from(STRAND_SIG_DOMAIN + pickId, 'utf8'), key).toString('base64');
}

/**
 * Verify a pickId signature. NEVER throws on malformed input — a garbled
 * signature, a non-key PEM, or any other decode failure is simply `false`
 * (the verifier's callers branch on booleans, not on exception taxonomy).
 */
export function verifyPickIdSig(publicKeyPem: string, pickId: string, sigBase64: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    const sig = Buffer.from(sigBase64, 'base64');
    return ed25519Verify(null, Buffer.from(STRAND_SIG_DOMAIN + pickId, 'utf8'), key, sig);
  } catch {
    return false; // malformed sig/key never throws into a caller — fail closed
  }
}

/* ── the key file (private material, 0600/0700) ────────────────────────────── */

export interface AgentKeyFile {
  schemaVersion: typeof AGENT_KEY_SCHEMA;
  principal: string;
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
}

function ensureKeysDirs(root: string): void {
  // mkdirSync's mode applies only to dirs it CREATES — re-assert like tokens.ts
  // re-asserts file modes, best-effort on exotic filesystems.
  fs.mkdirSync(agentKeysDirOf(root), { recursive: true, mode: 0o700 });
  for (const dir of [keysDirOf(root), agentKeysDirOf(root)]) {
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      /* best-effort */
    }
  }
}

function writeAgentKeyFile(root: string, key: AgentKeyFile): string {
  const p = agentKeyPathOf(root, key.principal);
  ensureKeysDirs(root);
  fs.writeFileSync(p, JSON.stringify(key, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600); // writeFile mode only applies on create — re-assert
  } catch {
    /* best-effort */
  }
  return p;
}

function isAgentKeyFileShape(row: unknown): row is AgentKeyFile {
  const k = row as AgentKeyFile;
  return (
    !!k &&
    typeof k === 'object' &&
    k.schemaVersion === AGENT_KEY_SCHEMA &&
    typeof k.principal === 'string' &&
    k.principal.length > 0 &&
    typeof k.keyId === 'string' &&
    k.keyId.startsWith(KEY_ID_PREFIX) &&
    typeof k.publicKeyPem === 'string' &&
    k.publicKeyPem.includes('PUBLIC KEY') &&
    typeof k.privateKeyPem === 'string' &&
    k.privateKeyPem.includes('PRIVATE KEY') &&
    typeof k.createdAt === 'string'
  );
}

/**
 * FAIL-CLOSED loader (tokens.ts posture): missing file → null; unparseable /
 * garbled / wrong-schema → ALSO null — never a throw into a caller that might
 * soften it into "no key, seal unsigned". A key we cannot interpret is a key
 * that does not resolve.
 */
export function loadAgentKey(root: string, principal: string): AgentKeyFile | null {
  if (!isPrincipalName(principal)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(agentKeyPathOf(root, principal), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isAgentKeyFileShape(parsed)) return null;
    if (parsed.principal !== principal) return null; // a swapped file never resolves
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The STRICT loader for CLI surfaces — same checks, precise throws so a human
 * reads WHY instead of a silent null.
 */
export function loadAgentKeyStrict(root: string, principal: string): AgentKeyFile {
  assertPrincipalName(principal);
  const p = agentKeyPathOf(root, principal);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `warpline: no signing key for "${principal}" — expected ${p}; mint one with \`warpline key mint ${principal}\``,
      );
    }
    throw new Error(`warpline: key file unreadable at ${p}: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`warpline: key file at ${p} is not valid JSON (${(err as Error).message}) — re-mint with \`warpline key mint ${principal}\``);
  }
  if (!isAgentKeyFileShape(parsed)) {
    throw new Error(
      `warpline: key file at ${p} is not a valid ${AGENT_KEY_SCHEMA} record — re-mint with \`warpline key mint ${principal}\``,
    );
  }
  if (parsed.principal !== principal) {
    throw new Error(
      `warpline: key file at ${p} names principal "${parsed.principal}", not "${principal}" — refusing a swapped key file`,
    );
  }
  return parsed;
}

/* ── the registry (public material, append-only) ───────────────────────────── */

export interface AgentKeyRegistryRow {
  schemaVersion: typeof KEY_REGISTRY_SCHEMA;
  kind: 'agent-key';
  keyId: string;
  principal: string;
  publicKeyPem: string;
  createdAt: string;
}

export interface SignedFromRegistryRow {
  schemaVersion: typeof KEY_REGISTRY_SCHEMA;
  kind: 'signed-from';
  /**
   * The fabric tip pickId at first mint — the signing-epoch boundary. `null`
   * when the first key was minted on an EMPTY fabric: the boundary is genesis,
   * every strand ever sealed is post-boundary.
   */
  signedFromPickId: string | null;
  createdAt: string;
}

export type KeyRegistryRow = AgentKeyRegistryRow | SignedFromRegistryRow;

export interface KeyRegistryReadResult {
  rows: KeyRegistryRow[];
  /** Malformed lines, skipped fail-closed — surfaced so an audit can SEE them. */
  malformed: Array<{ line: number; reason: string }>;
}

function validRegistryRow(row: unknown): row is KeyRegistryRow {
  const r = row as KeyRegistryRow;
  if (!r || typeof r !== 'object' || r.schemaVersion !== KEY_REGISTRY_SCHEMA) return false;
  if (r.kind === 'agent-key') {
    return (
      typeof r.keyId === 'string' &&
      r.keyId.startsWith(KEY_ID_PREFIX) &&
      typeof r.principal === 'string' &&
      r.principal.length > 0 &&
      typeof r.publicKeyPem === 'string' &&
      r.publicKeyPem.includes('PUBLIC KEY') &&
      typeof r.createdAt === 'string'
    );
  }
  if (r.kind === 'signed-from') {
    return (
      (r.signedFromPickId === null || (typeof r.signedFromPickId === 'string' && r.signedFromPickId.startsWith('pick:'))) &&
      typeof r.createdAt === 'string'
    );
  }
  return false; // an UNKNOWN kind fails closed — never interpreted as a key
}

/**
 * Read the registry, FAIL-CLOSED per row: a malformed row is skipped and
 * collected into `malformed` — it must never resolve to a usable key, and it
 * must never be invisible either (an audit that cannot see the skip cannot
 * question it).
 */
export function readKeyRegistry(root: string): KeyRegistryReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(keyRegistryPathOf(root), 'utf8');
  } catch {
    return { rows: [], malformed: [] };
  }
  const rows: KeyRegistryRow[] = [];
  const malformed: Array<{ line: number; reason: string }> = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (validRegistryRow(parsed)) rows.push(parsed);
      else malformed.push({ line: i + 1, reason: `not a valid ${KEY_REGISTRY_SCHEMA} row` });
    } catch (err) {
      malformed.push({ line: i + 1, reason: `unparseable JSON (${(err as Error).message})` });
    }
  }
  return { rows, malformed };
}

function appendRegistryRow(root: string, row: KeyRegistryRow): string {
  const p = keyRegistryPathOf(root);
  ensureKeysDirs(root);
  fs.appendFileSync(p, JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600); // appendFile mode only applies on create — re-assert
  } catch {
    /* best-effort */
  }
  return p;
}

/**
 * The LATEST agent-key row for a principal — last valid row in file order
 * (the file is append-only, so file order IS mint order; re-mint = append,
 * latest wins — mirrors token re-mint semantics). null = no usable key.
 */
export function registryKeyFor(root: string, principal: string): AgentKeyRegistryRow | null {
  let latest: AgentKeyRegistryRow | null = null;
  for (const row of readKeyRegistry(root).rows) {
    if (row.kind === 'agent-key' && row.principal === principal) latest = row;
  }
  return latest;
}

/**
 * The signing-epoch boundary: the FIRST signed-from row's pickId. Later
 * signed-from rows are IGNORED — the epoch pins exactly once, because a
 * movable boundary would let anyone un-sign history (append a later
 * "boundary" and every strand before it is grandfathered-unsigned again).
 *
 * `null` is honest about BOTH "no epoch pinned yet" and "pinned at genesis on
 * an empty fabric" (everything is post-boundary); `hasSignedFrom` separates
 * the two for callers that need to.
 */
export function signedFromOf(root: string): string | null {
  for (const row of readKeyRegistry(root).rows) {
    if (row.kind === 'signed-from') return row.signedFromPickId;
  }
  return null;
}

/** Whether a signing-epoch boundary has been pinned at all (see signedFromOf). */
export function hasSignedFrom(root: string): boolean {
  return readKeyRegistry(root).rows.some((r) => r.kind === 'signed-from');
}

/* ── mint (the human-gated CLI act, orchestrated here so the CLI stays thin) ── */

export interface MintAgentKeyResult {
  key: AgentKeyFile;
  keyPath: string;
  registryPath: string;
  /**
   * Present ONLY when this mint pinned the signing-epoch boundary (the first
   * mint ever). `signedFromPickId` null = pinned at genesis (empty fabric).
   */
  signedFrom: { signedFromPickId: string | null } | null;
}

/**
 * The current fabric tip pickId, read the way the seal path reads it
 * (seal.ts:174): `refs/heads/selvage` in refs mode; the physical ledger tail's
 * pickId on a legacy (unmigrated) repo; null on an empty fabric.
 */
function currentTipPickId(root: string): string | null {
  const wdir = warplineDirOf(root);
  const refTip = readRef(wdir, 'selvage');
  if (refTip !== null) return refTip;
  const fabric = readFabric(wdir);
  return fabric.length ? fabric[fabric.length - 1].pickId : null;
}

/**
 * Mint a signing key for a principal: generate the Ed25519 pair, write the
 * 0600 key file, append the agent-key registry row (PUBLIC material only) —
 * and, iff no signing-epoch boundary exists yet, pin `signed-from` at the
 * CURRENT fabric tip. Re-mint appends; the latest registry row wins.
 *
 * HUMAN-GATED at the CLI (the #agent-shell credential) — this function is the
 * mechanism, the CLI owns the gate, exactly like mintToken.
 */
export function mintAgentKey(root: string, principal: string, opts: { now?: string } = {}): MintAgentKeyResult {
  assertPrincipalName(principal);
  const now = opts.now ?? new Date().toISOString();
  const generated = generateAgentKey();
  const key: AgentKeyFile = {
    schemaVersion: AGENT_KEY_SCHEMA,
    principal,
    keyId: generated.keyId,
    publicKeyPem: generated.publicKeyPem,
    privateKeyPem: generated.privateKeyPem,
    createdAt: now,
  };
  const keyPath = writeAgentKeyFile(root, key);
  const registryPath = appendRegistryRow(root, {
    schemaVersion: KEY_REGISTRY_SCHEMA,
    kind: 'agent-key',
    keyId: key.keyId,
    principal,
    publicKeyPem: key.publicKeyPem,
    createdAt: now,
  });
  let signedFrom: MintAgentKeyResult['signedFrom'] = null;
  if (!hasSignedFrom(root)) {
    const tip = currentTipPickId(root);
    appendRegistryRow(root, {
      schemaVersion: KEY_REGISTRY_SCHEMA,
      kind: 'signed-from',
      signedFromPickId: tip,
      createdAt: now,
    });
    signedFrom = { signedFromPickId: tip };
  }
  return { key, keyPath, registryPath, signedFrom };
}

/* ── redacted listing for `warpline key list` ──────────────────────────────── */

export interface KeySummary {
  principal: string;
  keyId: string;
  createdAt: string;
  /**
   * THIS key's private half is on the box: the 0600 key file exists AND its
   * keyId matches this row (a rotated-away row shows false — its private
   * material was overwritten by the re-mint).
   */
  keyFilePresent: boolean;
  /** this row is the LATEST for its principal (the one that resolves). */
  latest: boolean;
}

export interface KeyListResult {
  keys: KeySummary[];
  signedFrom: { signedFromPickId: string | null; createdAt: string } | null;
  malformed: Array<{ line: number; reason: string }>;
}

/** Registry summary (public material only — nothing here is a secret). */
export function listKeySummaries(root: string): KeyListResult {
  const { rows, malformed } = readKeyRegistry(root);
  let signedFrom: KeyListResult['signedFrom'] = null;
  const agentRows = rows.filter((r): r is AgentKeyRegistryRow => r.kind === 'agent-key');
  for (const row of rows) {
    if (row.kind === 'signed-from' && signedFrom === null) {
      signedFrom = { signedFromPickId: row.signedFromPickId, createdAt: row.createdAt };
    }
  }
  const latestOf = new Map<string, AgentKeyRegistryRow>();
  for (const row of agentRows) latestOf.set(row.principal, row); // file order — last wins
  const fileOf = new Map<string, AgentKeyFile | null>();
  const keys = agentRows.map((row) => {
    if (!fileOf.has(row.principal)) fileOf.set(row.principal, loadAgentKey(root, row.principal));
    const file = fileOf.get(row.principal) ?? null;
    return {
      principal: row.principal,
      keyId: row.keyId,
      createdAt: row.createdAt,
      keyFilePresent: file !== null && file.keyId === row.keyId,
      latest: latestOf.get(row.principal) === row,
    };
  });
  return { keys, signedFrom, malformed };
}

/**
 * #grants — M3-lite I6 (m3-integrity-design-2026-08-23.md §6 Q3 ruling +
 * TD-2026-08-23-136 item 4): HUMAN-ISSUED auto-resolve grants.
 *
 * `resolve` stays inside HUMAN_ONLY_VERBS — the frozen descriptor invariants
 * (descriptors-frozen.test.ts) do not move. A grant is an exception INSIDE the
 * gate: an agent-class resolve attempt is allowed IFF an active grant matches,
 * and the resolution strand then records `underGrant: grantId` (inside the
 * pickId preimage — attribution-load-bearing). Grants cover RESOLVE ONLY —
 * never stake / stake.recover / backup.
 *
 * THE GRANT IS PROCEDURALLY BOUND, not cryptographically signed: by the Q3
 * ruling NO cryptographic human signature exists — issuing/revoking is a
 * console/CLI human-class act gated exactly like `warpline key mint` (the
 * agent-shell credential). Scoped, revocable, auditable:
 *   - STORE   `.warpline/grants/auto-resolve.jsonl`, append-only rows, strict
 *             union (grant | revoke), reader fail-closed per row (the keys.ts
 *             registry pattern) — a malformed row never resolves to authority,
 *             and it is surfaced so an audit can SEE the skip.
 *   - IDENTITY grantId = 'grant:' + sha256 over the CANONICAL grant body (the
 *             row minus grantId). Recomputed on READ: a row whose stored id
 *             does not reproduce from its own body is a tampered row and fails
 *             closed (the id and the stored scope/ttl can never disagree).
 *   - TTL     expiresAt is REQUIRED — no unbounded grants; capped at 7 days,
 *             refuse longer. Expiry is STRICT: at expiresAt the grant is dead.
 *   - REVOKE  a revoke row wins over any later re-read — at enforcement time a
 *             revoked grantId never matches again, regardless of timestamps
 *             (fail closed). Historically (verify), a strand sealed BEFORE the
 *             revocation instant was legitimately under grant.
 *
 * DEFAULT OFF (v2 §A11 — the field test runs with NO grant active): a repo with
 * no grant store behaves byte-identically to a pre-grant repo. activeGrantFor
 * on a missing file is null with zero side effects; every gate refusal on the
 * no-grant path is EXACTLY today's human-class refusal.
 *
 * Library code: no console output — the CLI prints.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalSerialize } from '../warp/canonical.js';
import { canonicalSafe } from './strand.js';
import { warplineDirOf } from './fabric.js';

export const GRANT_SCHEMA = 'grant:v1' as const;
export const GRANT_ID_PREFIX = 'grant:' as const;

/** The one grant TTL ceiling — no grant may outlive 7 days (refuse longer). */
export const GRANT_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** The CLI's default TTL when none is given: 24 hours. */
export const GRANT_TTL_DEFAULT_MS = 24 * 60 * 60 * 1000;

export interface GrantScope {
  /** exact branch the grant covers; ABSENT = all branches. */
  branch?: string;
  /**
   * forward-compat narrowing. 'any' (or absent) covers every KNOT class.
   * 'over-block-suspect' is STORED but NEVER matches at the gate today: the
   * gate cannot classify the knot at enforcement time, and a scope we cannot
   * check is a scope that does not match (fail closed, keys.ts posture).
   */
  knotClass?: 'over-block-suspect' | 'any';
}

export interface GrantRow {
  schemaVersion: typeof GRANT_SCHEMA;
  kind: 'grant';
  /** 'grant:' + sha256 over the canonical body (this row minus grantId). */
  grantId: string;
  scope: GrantScope;
  /** expiresAt REQUIRED — no unbounded grants (cap: GRANT_TTL_MAX_MS). */
  ttl: { issuedAt: string; expiresAt: string };
  /** the Q3 ruling: issuance is a human-class act, procedurally bound. */
  issuedBy: 'human';
  note?: string;
}

export interface RevokeRow {
  schemaVersion: typeof GRANT_SCHEMA;
  kind: 'revoke';
  grantId: string;
  revokedAt: string;
}

export type GrantStoreRow = GrantRow | RevokeRow;

export interface GrantStoreReadResult {
  rows: GrantStoreRow[];
  /** malformed/tampered lines, skipped fail-closed — surfaced, never silent. */
  malformed: Array<{ line: number; reason: string }>;
}

/* ── paths ──────────────────────────────────────────────────────────────────── */

export function grantsDirOf(root: string): string {
  return path.join(warplineDirOf(root), 'grants');
}

export function grantsPathOf(root: string): string {
  return path.join(grantsDirOf(root), 'auto-resolve.jsonl');
}

/* ── identity ───────────────────────────────────────────────────────────────── */

/** The canonical grant body — EXACTLY the row minus grantId (deterministic). */
function grantBodyOf(row: Omit<GrantRow, 'grantId'>): Omit<GrantRow, 'grantId'> {
  return {
    schemaVersion: row.schemaVersion,
    kind: row.kind,
    scope: {
      ...(row.scope.branch !== undefined ? { branch: row.scope.branch } : {}),
      ...(row.scope.knotClass !== undefined ? { knotClass: row.scope.knotClass } : {}),
    },
    ttl: { issuedAt: row.ttl.issuedAt, expiresAt: row.ttl.expiresAt },
    issuedBy: row.issuedBy,
    ...(row.note !== undefined ? { note: row.note } : {}),
  };
}

/** grantId = 'grant:' + sha256(canonical grant body, utf8), hex. */
export function computeGrantId(body: Omit<GrantRow, 'grantId'>): string {
  const canon = canonicalSerialize(canonicalSafe(grantBodyOf(body)));
  return GRANT_ID_PREFIX + createHash('sha256').update(canon, 'utf8').digest('hex');
}

/* ── the fail-closed reader (keys.ts registry pattern) ──────────────────────── */

function parseIso(ts: string): number | null {
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

function validGrantStoreRow(row: unknown): row is GrantStoreRow {
  const r = row as GrantStoreRow;
  if (!r || typeof r !== 'object' || r.schemaVersion !== GRANT_SCHEMA) return false;
  if (r.kind === 'grant') {
    const g = r as GrantRow;
    return (
      typeof g.grantId === 'string' &&
      g.grantId.startsWith(GRANT_ID_PREFIX) &&
      !!g.scope &&
      typeof g.scope === 'object' &&
      (g.scope.branch === undefined || (typeof g.scope.branch === 'string' && g.scope.branch.length > 0)) &&
      (g.scope.knotClass === undefined || g.scope.knotClass === 'over-block-suspect' || g.scope.knotClass === 'any') &&
      !!g.ttl &&
      typeof g.ttl === 'object' &&
      typeof g.ttl.issuedAt === 'string' &&
      parseIso(g.ttl.issuedAt) !== null &&
      typeof g.ttl.expiresAt === 'string' && // expiresAt REQUIRED — no unbounded grants
      parseIso(g.ttl.expiresAt) !== null &&
      g.issuedBy === 'human' &&
      (g.note === undefined || typeof g.note === 'string')
    );
  }
  if (r.kind === 'revoke') {
    return (
      typeof r.grantId === 'string' &&
      r.grantId.startsWith(GRANT_ID_PREFIX) &&
      typeof r.revokedAt === 'string' &&
      parseIso(r.revokedAt) !== null
    );
  }
  return false; // an UNKNOWN kind fails closed — never interpreted as authority
}

/**
 * Read the grant store, FAIL-CLOSED per row: a malformed row is skipped and
 * collected in `malformed`; a grant row whose stored grantId does not
 * REPRODUCE from its own body is a TAMPERED row and is skipped the same way
 * (the id pins scope + ttl; an edited scope can never keep its authority).
 * A missing file is the empty store — the zero-grant world, zero side effects.
 */
export function readGrantStore(root: string): GrantStoreReadResult {
  let raw: string;
  try {
    raw = fs.readFileSync(grantsPathOf(root), 'utf8');
  } catch {
    return { rows: [], malformed: [] };
  }
  const rows: GrantStoreRow[] = [];
  const malformed: Array<{ line: number; reason: string }> = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!validGrantStoreRow(parsed)) {
        malformed.push({ line: i + 1, reason: `not a valid ${GRANT_SCHEMA} row` });
        continue;
      }
      if (parsed.kind === 'grant') {
        const { grantId, ...body } = parsed;
        if (computeGrantId(body) !== grantId) {
          malformed.push({ line: i + 1, reason: 'grantId does not reproduce from the row body (tampered scope/ttl)' });
          continue;
        }
      }
      rows.push(parsed);
    } catch (err) {
      malformed.push({ line: i + 1, reason: `unparseable JSON (${(err as Error).message})` });
    }
  }
  return { rows, malformed };
}

function appendGrantRow(root: string, row: GrantStoreRow): string {
  const p = grantsPathOf(root);
  fs.mkdirSync(grantsDirOf(root), { recursive: true, mode: 0o700 });
  fs.appendFileSync(p, JSON.stringify(row) + '\n', { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(p, 0o600); // appendFile mode only applies on create — re-assert
  } catch {
    /* best-effort */
  }
  return p;
}

/* ── ISSUE / REVOKE (the mechanism — the CLI owns the human-class gate) ─────── */

export interface IssueGrantOptions {
  /** exact branch scope; absent = all branches. */
  branch?: string;
  /** milliseconds to live (default 24h; capped at 7d, refuse longer). */
  ttlMs?: number;
  note?: string;
  /** injectable clock (ISO) — determinism in tests. */
  now?: string;
}

export interface IssueGrantResult {
  grant: GrantRow;
  storePath: string;
}

/**
 * Issue an auto-resolve grant. HUMAN-GATED at the CLI (the #agent-shell
 * credential, exactly like `warpline key mint`) — this function is the
 * mechanism only. Refuses an unbounded or over-cap TTL.
 */
export function issueGrant(root: string, opts: IssueGrantOptions = {}): IssueGrantResult {
  const now = opts.now ?? new Date().toISOString();
  const issuedAtMs = parseIso(now);
  if (issuedAtMs === null) throw new Error(`warpline: grant refused — "${now}" is not a valid ISO timestamp`);
  const ttlMs = opts.ttlMs ?? GRANT_TTL_DEFAULT_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('warpline: grant refused — ttl must be a positive duration (expiresAt is REQUIRED; no unbounded grants)');
  }
  if (ttlMs > GRANT_TTL_MAX_MS) {
    throw new Error(
      `warpline: grant refused — ttl ${ttlMs}ms exceeds the 7-day cap (${GRANT_TTL_MAX_MS}ms). ` +
        `A standing exception to a security law must keep expiring; re-issue when it lapses.`,
    );
  }
  const body: Omit<GrantRow, 'grantId'> = {
    schemaVersion: GRANT_SCHEMA,
    kind: 'grant',
    scope: {
      ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
    },
    ttl: { issuedAt: now, expiresAt: new Date(issuedAtMs + ttlMs).toISOString() },
    issuedBy: 'human',
    ...(opts.note !== undefined ? { note: opts.note } : {}),
  };
  const grant: GrantRow = { ...body, grantId: computeGrantId(body) };
  const storePath = appendGrantRow(root, grant);
  return { grant, storePath };
}

export interface RevokeGrantResult {
  revoke: RevokeRow;
  storePath: string;
}

/**
 * Revoke a grant by id (or a ≥12-char unique prefix). HUMAN-GATED at the CLI.
 * Refuses an id that names no valid grant row — a revocation of nothing is a
 * typo, not an audit event.
 */
export function revokeGrant(root: string, grantId: string, opts: { now?: string } = {}): RevokeGrantResult {
  const now = opts.now ?? new Date().toISOString();
  const grants = readGrantStore(root).rows.filter((r): r is GrantRow => r.kind === 'grant');
  const matches =
    grantId.length >= GRANT_ID_PREFIX.length + 12
      ? grants.filter((g) => g.grantId === grantId || g.grantId.startsWith(grantId))
      : grants.filter((g) => g.grantId === grantId);
  if (matches.length === 0) {
    throw new Error(`warpline: grant revoke refused — ${JSON.stringify(grantId)} names no grant in ${grantsPathOf(root)}`);
  }
  if (new Set(matches.map((g) => g.grantId)).size > 1) {
    throw new Error(`warpline: grant revoke refused — ${JSON.stringify(grantId)} is ambiguous (${matches.length} grants match)`);
  }
  const revoke: RevokeRow = { schemaVersion: GRANT_SCHEMA, kind: 'revoke', grantId: matches[0].grantId, revokedAt: now };
  const storePath = appendGrantRow(root, revoke);
  return { revoke, storePath };
}

/* ── the enforcement query (both gates call this) ───────────────────────────── */

export interface ActiveGrantQuery {
  /** the branch the resolve targets (resolveNative advances selvage only today). */
  branch: string;
  /** ISO instant of the attempt (defaults to the wall clock). */
  now?: string;
}

/**
 * The LATEST non-revoked, non-expired grant whose scope matches — or null.
 *
 * Matching rules (each fails CLOSED):
 *   - REVOKE WINS over any later re-read: a grantId with ANY revoke row never
 *     matches again at enforcement time, regardless of timestamps.
 *   - EXPIRY IS STRICT: `now < expiresAt` (at the boundary instant the grant
 *     is already dead) and `issuedAt <= now` (a not-yet-valid row is no grant).
 *   - BRANCH: exact match, or the grant has no branch scope (= all branches).
 *   - KNOT CLASS: 'any'/absent matches; 'over-block-suspect' NEVER matches at
 *     the gate (the class is unknowable at enforcement time — fail closed).
 *   - latest wins: last matching row in file order (append-only = issue order).
 */
export function activeGrantFor(root: string, query: ActiveGrantQuery): GrantRow | null {
  const { rows } = readGrantStore(root);
  if (rows.length === 0) return null; // the zero-grant world — byte-identical to today
  const nowMs = parseIso(query.now ?? new Date().toISOString());
  if (nowMs === null) return null; // an unreadable clock never grants anything
  const revoked = new Set(rows.filter((r): r is RevokeRow => r.kind === 'revoke').map((r) => r.grantId));
  let latest: GrantRow | null = null;
  for (const row of rows) {
    if (row.kind !== 'grant') continue;
    if (revoked.has(row.grantId)) continue; // revoke wins
    const issuedMs = parseIso(row.ttl.issuedAt);
    const expiresMs = parseIso(row.ttl.expiresAt);
    if (issuedMs === null || expiresMs === null) continue; // unreadable ttl → no authority
    if (expiresMs - issuedMs > GRANT_TTL_MAX_MS) continue; // forged over-cap span → no authority (Aegis 2026-08-24)
    if (!(issuedMs <= nowMs && nowMs < expiresMs)) continue; // strict expiry
    if (row.scope.branch !== undefined && row.scope.branch !== query.branch) continue;
    if (row.scope.knotClass !== undefined && row.scope.knotClass !== 'any') continue; // fail closed
    latest = row; // file order — last match wins
  }
  return latest;
}

/* ── the historical check (verify/fsck: grant-violation) ────────────────────── */

export interface GrantAtCheck {
  ok: boolean;
  /** why the grant was NOT active at the instant (absent when ok). */
  reason?: string;
}

/**
 * Was `grantId` active — non-revoked, non-expired, scope-matched — at the
 * instant `at` (a resolves-strand's recordedAt)? Unlike activeGrantFor, a
 * revoke here is checked AGAINST THE INSTANT: a strand sealed before the
 * revocation was legitimately under grant; the revoke does not retroactively
 * invalidate history. Everything else fails closed identically.
 */
export function grantActiveAt(root: string, grantId: string, query: { at: string; branch: string }): GrantAtCheck {
  const { rows } = readGrantStore(root);
  const grant = rows.find((r): r is GrantRow => r.kind === 'grant' && r.grantId === grantId);
  if (!grant) {
    return { ok: false, reason: `underGrant names no valid grant row in ${grantsPathOf(root)} (missing store, tampered row, or a forged id)` };
  }
  const atMs = parseIso(query.at);
  if (atMs === null) return { ok: false, reason: `recordedAt "${query.at}" is not a valid instant` };
  const issuedMs = parseIso(grant.ttl.issuedAt)!;
  const expiresMs = parseIso(grant.ttl.expiresAt)!;
  if (expiresMs - issuedMs > GRANT_TTL_MAX_MS) {
    return { ok: false, reason: `grant span ${grant.ttl.issuedAt}..${grant.ttl.expiresAt} exceeds the 7-day cap — an over-cap row carries no authority (forged or hand-widened)` };
  }
  if (atMs < issuedMs) return { ok: false, reason: `sealed at ${query.at}, BEFORE the grant was issued (${grant.ttl.issuedAt})` };
  if (atMs >= expiresMs) return { ok: false, reason: `sealed at ${query.at}, at/after the grant's expiry (${grant.ttl.expiresAt} — expiry is strict)` };
  for (const row of rows) {
    if (row.kind === 'revoke' && row.grantId === grantId) {
      const revokedMs = parseIso(row.revokedAt);
      if (revokedMs !== null && revokedMs <= atMs) {
        return { ok: false, reason: `sealed at ${query.at}, at/after the grant was revoked (${row.revokedAt})` };
      }
    }
  }
  if (grant.scope.branch !== undefined && grant.scope.branch !== query.branch) {
    return { ok: false, reason: `grant is scoped to branch "${grant.scope.branch}" but the resolution landed on "${query.branch}"` };
  }
  if (grant.scope.knotClass !== undefined && grant.scope.knotClass !== 'any') {
    // Symmetric with the gate: a class-narrowed grant never matches (the class
    // is uncheckable), so no strand can legitimately carry one — fail closed.
    return { ok: false, reason: `grant is scoped to knotClass "${grant.scope.knotClass}", which the gate can never match (fail closed)` };
  }
  return { ok: true };
}

/* ── listing (agent-readable — a plain read) ────────────────────────────────── */

export interface GrantSummary {
  grantId: string;
  scope: GrantScope;
  issuedAt: string;
  expiresAt: string;
  note?: string;
  status: 'active' | 'expired' | 'revoked';
  revokedAt?: string;
}

export interface GrantListResult {
  grants: GrantSummary[];
  malformed: Array<{ line: number; reason: string }>;
}

export function listGrantSummaries(root: string, opts: { now?: string } = {}): GrantListResult {
  const { rows, malformed } = readGrantStore(root);
  const nowMs = parseIso(opts.now ?? new Date().toISOString()) ?? Date.now();
  const revokedAtOf = new Map<string, string>();
  for (const row of rows) {
    if (row.kind === 'revoke' && !revokedAtOf.has(row.grantId)) revokedAtOf.set(row.grantId, row.revokedAt);
  }
  const grants = rows
    .filter((r): r is GrantRow => r.kind === 'grant')
    .map((g): GrantSummary => {
      const revokedAt = revokedAtOf.get(g.grantId);
      const expiresMs = parseIso(g.ttl.expiresAt) ?? 0;
      return {
        grantId: g.grantId,
        scope: g.scope,
        issuedAt: g.ttl.issuedAt,
        expiresAt: g.ttl.expiresAt,
        ...(g.note !== undefined ? { note: g.note } : {}),
        status: revokedAt !== undefined ? 'revoked' : nowMs >= expiresMs ? 'expired' : 'active',
        ...(revokedAt !== undefined ? { revokedAt } : {}),
      };
    });
  return { grants, malformed };
}

/* ── duration parsing (the CLI's --ttl skin; library-pure, throws precise) ───── */

/** Parse `<n>m|<n>h|<n>d` to milliseconds (e.g. '24h', '7d', '90m'). */
export function parseGrantTtl(dur: string): number {
  const m = /^(\d+)(m|h|d)$/.exec(dur.trim());
  if (!m) {
    throw new Error(`warpline: grant refused — ttl ${JSON.stringify(dur)} is not <n>m|<n>h|<n>d (e.g. 24h, 7d, 90m)`);
  }
  const n = Number(m[1]);
  const unit = m[2] === 'm' ? 60_000 : m[2] === 'h' ? 3_600_000 : 86_400_000;
  return n * unit;
}

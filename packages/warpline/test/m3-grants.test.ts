/**
 * m3-grants.test — M3-lite I6 (#grants): the auto-resolve grant store + the
 * underGrant preimage rule, unit-level (the end-to-end arms live in
 * m3-falsifier.test.ts).
 *
 * Pinned here:
 *   STORE     append-only grant:v1 rows; grantId reproduces from the canonical
 *             body (a tampered scope/ttl loses its authority — fail closed);
 *             malformed rows skipped AND surfaced; missing file = empty store.
 *   TTL       expiresAt REQUIRED; default 24h; 7-day cap refused; expiry
 *             STRICT (dead at the boundary instant).
 *   MATCH     activeGrantFor: branch exact-or-absent; knotClass
 *             'over-block-suspect' NEVER matches (uncheckable at the gate —
 *             fail closed); revoke wins over any later re-read; latest wins.
 *   HISTORY   grantActiveAt: a strand sealed BEFORE a revocation instant was
 *             legitimately under grant; at/after it was not.
 *   PREIMAGE  underGrant is INSIDE the pickId preimage in BOTH sealing epochs:
 *             v2 (rides the `...rest` spread — verified, not assumed) and v3
 *             (listed explicitly); absent = absent from the preimage; and a
 *             v3 underGrant without resolves is refused at construction
 *             (grants cover RESOLVE only).
 *
 * NEVER against the live fabric — scratch tmp roots only.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  GRANT_SCHEMA,
  GRANT_TTL_MAX_MS,
  computeGrantId,
  grantsPathOf,
  readGrantStore,
  issueGrant,
  revokeGrant,
  activeGrantFor,
  grantActiveAt,
  listGrantSummaries,
  parseGrantTtl,
  type GrantRow,
} from '../src/fabric/grants.js';
import { computePickId, buildStrandV3, type StrandBody, type StrandDelta, type KnotResolution } from '../src/fabric/strand.js';

const T0 = '2026-08-24T00:00:00.000Z';
const HOUR = 3_600_000;

/** an ISO instant `ms` after T0. */
const at = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-grants-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Append a raw line to the grant store (forgery/malformed-row rigs). */
function appendRaw(r: string, line: string): void {
  fs.mkdirSync(path.dirname(grantsPathOf(r)), { recursive: true });
  fs.appendFileSync(grantsPathOf(r), line + '\n', 'utf8');
}

/** A VALID hand-built grant row (grantId reproduces) — for scope shapes the CLI never issues. */
function forgeValidGrant(r: string, body: Omit<GrantRow, 'grantId'>): GrantRow {
  const row: GrantRow = { ...body, grantId: computeGrantId(body) };
  appendRaw(r, JSON.stringify(row));
  return row;
}

describe('I6 — the grant store (append-only, fail-closed reader)', () => {
  it('missing store = empty store, zero side effects (the zero-grant world)', () => {
    expect(readGrantStore(root)).toEqual({ rows: [], malformed: [] });
    expect(activeGrantFor(root, { branch: 'selvage', now: T0 })).toBeNull();
    expect(fs.existsSync(grantsPathOf(root))).toBe(false); // the read created NOTHING
  });

  it('issue → the row round-trips and its grantId reproduces from the body', () => {
    const { grant } = issueGrant(root, { now: T0, note: 'field test window' });
    expect(grant.schemaVersion).toBe(GRANT_SCHEMA);
    expect(grant.issuedBy).toBe('human');
    expect(grant.ttl).toEqual({ issuedAt: T0, expiresAt: at(24 * HOUR) }); // default 24h
    const { grantId, ...body } = grant;
    expect(computeGrantId(body)).toBe(grantId);
    expect(readGrantStore(root).rows).toEqual([grant]);
  });

  it('TTL law: expiresAt required (non-positive refused), 7-day cap refused, 7d exact allowed', () => {
    expect(() => issueGrant(root, { now: T0, ttlMs: 0 })).toThrow(/no unbounded grants/);
    expect(() => issueGrant(root, { now: T0, ttlMs: -1 })).toThrow(/no unbounded grants/);
    expect(() => issueGrant(root, { now: T0, ttlMs: GRANT_TTL_MAX_MS + 1 })).toThrow(/7-day cap/);
    const { grant } = issueGrant(root, { now: T0, ttlMs: GRANT_TTL_MAX_MS });
    expect(grant.ttl.expiresAt).toBe(at(GRANT_TTL_MAX_MS));
  });

  it('a TAMPERED row (edited body under the old grantId) is malformed and never resolves', () => {
    const { grant } = issueGrant(root, { now: T0 });
    // widen the ttl by hand, keeping the stored grantId — the id no longer reproduces
    const tampered = { ...grant, ttl: { issuedAt: T0, expiresAt: at(365 * 24 * HOUR) } };
    fs.writeFileSync(grantsPathOf(root), JSON.stringify(tampered) + '\n', 'utf8');
    const { rows, malformed } = readGrantStore(root);
    expect(rows).toEqual([]);
    expect(malformed).toEqual([{ line: 1, reason: expect.stringContaining('does not reproduce') }]);
    expect(activeGrantFor(root, { branch: 'selvage', now: at(30 * 24 * HOUR) })).toBeNull();
  });

  it('malformed JSON / unknown kinds are skipped fail-closed AND surfaced', () => {
    issueGrant(root, { now: T0 });
    appendRaw(root, 'not json at all');
    appendRaw(root, JSON.stringify({ schemaVersion: GRANT_SCHEMA, kind: 'super-grant', grantId: 'grant:x' }));
    const { rows, malformed } = readGrantStore(root);
    expect(rows).toHaveLength(1);
    expect(malformed).toHaveLength(2);
    expect(malformed.map((m) => m.line)).toEqual([2, 3]);
  });
});

describe('I6 — activeGrantFor (the gate query, every miss fails closed)', () => {
  it('expiry is STRICT: alive just before expiresAt, dead AT it', () => {
    issueGrant(root, { now: T0, ttlMs: 24 * HOUR });
    expect(activeGrantFor(root, { branch: 'selvage', now: at(24 * HOUR - 1) })).not.toBeNull();
    expect(activeGrantFor(root, { branch: 'selvage', now: at(24 * HOUR) })).toBeNull();
    // and not-yet-valid is not valid
    expect(activeGrantFor(root, { branch: 'selvage', now: at(-1) })).toBeNull();
  });

  it('branch scope: exact match or absent-scope-matches-all; a mismatch never grants', () => {
    const { grant } = issueGrant(root, { now: T0, branch: 'selvage' });
    expect(activeGrantFor(root, { branch: 'selvage', now: at(HOUR) })?.grantId).toBe(grant.grantId);
    expect(activeGrantFor(root, { branch: 'feature-x', now: at(HOUR) })).toBeNull();
    const all = issueGrant(root, { now: T0 }).grant; // no branch = all branches
    expect(activeGrantFor(root, { branch: 'feature-x', now: at(HOUR) })?.grantId).toBe(all.grantId);
  });

  it("knotClass 'any' matches; 'over-block-suspect' NEVER matches at the gate (fail closed)", () => {
    const anyClass = forgeValidGrant(root, {
      schemaVersion: GRANT_SCHEMA,
      kind: 'grant',
      scope: { knotClass: 'any' },
      ttl: { issuedAt: T0, expiresAt: at(24 * HOUR) },
      issuedBy: 'human',
    });
    expect(activeGrantFor(root, { branch: 'selvage', now: at(HOUR) })?.grantId).toBe(anyClass.grantId);
    fs.rmSync(grantsPathOf(root));
    forgeValidGrant(root, {
      schemaVersion: GRANT_SCHEMA,
      kind: 'grant',
      scope: { knotClass: 'over-block-suspect' },
      ttl: { issuedAt: T0, expiresAt: at(24 * HOUR) },
      issuedBy: 'human',
    });
    // the gate cannot classify the knot at enforcement time — a scope it
    // cannot check is a scope that does not match.
    expect(activeGrantFor(root, { branch: 'selvage', now: at(HOUR) })).toBeNull();
  });

  it('REVOKE WINS over any later re-read; unknown/ambiguous revoke ids are refused; prefix revoke works', () => {
    const { grant } = issueGrant(root, { now: T0 });
    expect(() => revokeGrant(root, 'grant:doesnotexist000', { now: T0 })).toThrow(/names no grant/);
    revokeGrant(root, grant.grantId.slice(0, 'grant:'.length + 12), { now: at(HOUR) });
    expect(activeGrantFor(root, { branch: 'selvage', now: at(2 * HOUR) })).toBeNull();
    // status surfaces in the (agent-readable) listing
    const listed = listGrantSummaries(root, { now: at(2 * HOUR) });
    expect(listed.grants).toEqual([expect.objectContaining({ grantId: grant.grantId, status: 'revoked', revokedAt: at(HOUR) })]);
  });

  it('latest wins: the LAST matching row in file (=issue) order is the one returned', () => {
    const g1 = issueGrant(root, { now: T0, note: 'first' }).grant;
    const g2 = issueGrant(root, { now: at(1), note: 'second' }).grant;
    expect(g1.grantId).not.toBe(g2.grantId);
    expect(activeGrantFor(root, { branch: 'selvage', now: at(HOUR) })?.grantId).toBe(g2.grantId);
  });
});

describe('I6 — over-cap grant span carries NO authority (Aegis review fix, 2026-08-24)', () => {
  it('a self-consistent forged row with a 10-year span never matches — gate and history both', () => {
    const issuedAt = '2026-08-01T00:00:00.000Z';
    const g = forgeValidGrant(root, {
      schemaVersion: 'grant:v1',
      kind: 'grant',
      scope: {},
      ttl: { issuedAt, expiresAt: '2036-08-01T00:00:00.000Z' }, // 10 years — over the 7d cap
      issuedBy: 'human',
    });
    // Gate: inside the pretended window, still no authority.
    expect(activeGrantFor(root, { branch: 'selvage', now: '2026-08-02T00:00:00.000Z' })).toBeNull();
    // History: a seal recorded inside the forged window still fails.
    const check = grantActiveAt(root, g.grantId, { at: '2026-08-02T00:00:00.000Z', branch: 'selvage' });
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/exceeds the 7-day cap/);
  });
});

describe('I6 — grantActiveAt (the verify-side historical check)', () => {
  it('a strand sealed BEFORE the revocation instant was under grant; at/after it was not', () => {
    const { grant } = issueGrant(root, { now: T0 });
    revokeGrant(root, grant.grantId, { now: at(2 * HOUR) });
    expect(grantActiveAt(root, grant.grantId, { at: at(HOUR), branch: 'selvage' })).toEqual({ ok: true });
    expect(grantActiveAt(root, grant.grantId, { at: at(2 * HOUR), branch: 'selvage' }).ok).toBe(false);
    expect(grantActiveAt(root, grant.grantId, { at: at(3 * HOUR), branch: 'selvage' }).reason).toMatch(/revoked/);
  });

  it('expiry strict + issue boundary + scope mismatch + unknown id all fail with precise reasons', () => {
    const { grant } = issueGrant(root, { now: T0, ttlMs: 24 * HOUR, branch: 'selvage' });
    expect(grantActiveAt(root, grant.grantId, { at: at(-1), branch: 'selvage' }).reason).toMatch(/BEFORE the grant was issued/);
    expect(grantActiveAt(root, grant.grantId, { at: at(24 * HOUR), branch: 'selvage' }).reason).toMatch(/expiry is strict/);
    expect(grantActiveAt(root, grant.grantId, { at: at(HOUR), branch: 'feature-x' }).reason).toMatch(/scoped to branch/);
    expect(grantActiveAt(root, 'grant:' + 'f'.repeat(64), { at: at(HOUR), branch: 'selvage' }).reason).toMatch(/names no valid grant row/);
  });
});

describe('I6 — parseGrantTtl (the CLI --ttl skin)', () => {
  it('parses m/h/d and refuses junk', () => {
    expect(parseGrantTtl('90m')).toBe(90 * 60_000);
    expect(parseGrantTtl('24h')).toBe(24 * HOUR);
    expect(parseGrantTtl('7d')).toBe(7 * 24 * HOUR);
    for (const bad of ['', '24', 'h', '1w', '1.5h', '-2h']) {
      expect(() => parseGrantTtl(bad), bad).toThrow(/not <n>m\|<n>h\|<n>d/);
    }
  });
});

/* ── the PREIMAGE rule, both sealing epochs ──────────────────────────────────── */

const EMPTY_DELTA: StrandDelta = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };
const RESOLUTION: KnotResolution = {
  decidedBy: 'agent-b',
  reason: 'granted window',
  base: 'warp:base',
  against: 'warp:selvage',
  contended: ['foo'],
  resolvedSymbols: ['foo'],
};

describe('I6 — underGrant is INSIDE the pickId preimage (both epochs)', () => {
  it("v2: underGrant rides the `...rest` spread — VERIFIED, not assumed (add/change/strip all move the id)", () => {
    const body: StrandBody = {
      schemaVersion: 2,
      seq: 3,
      parentPickId: 'pick:v2:' + 'a'.repeat(64),
      stateId: 'warp:state',
      parentStateId: 'warp:parent',
      actor: 'agent-b',
      authoredBy: { agentId: 'agent-b' },
      intent: 'resolve knot — granted',
      recordedAt: T0,
      objectCount: 1,
      delta: EMPTY_DELTA,
      calibratedConfidence: null,
      provenance: { ref: 'refs/heads/selvage', treeSha: null, gitCommit: null },
      resolves: RESOLUTION,
    };
    const bare = computePickId(body);
    const granted = computePickId({ ...body, underGrant: 'grant:' + '1'.repeat(64) });
    const regranted = computePickId({ ...body, underGrant: 'grant:' + '2'.repeat(64) });
    expect(granted).not.toBe(bare); // grafting the field breaks the identity…
    expect(regranted).not.toBe(granted); // …and so does swapping which grant is named
    // sig stays EXCLUDED (circularity) even next to underGrant
    expect(
      computePickId({
        ...body,
        underGrant: 'grant:' + '1'.repeat(64),
        sig: { keyId: 'wlkey:v1:x', sigBase64: 'AAAA', principal: 'agent-b', schemaVersion: 'strandSig:v1' },
      }),
    ).toBe(granted);
  });

  it('v3: underGrant is listed EXPLICITLY in the preimage; absent = absent (identities of old strands hold)', () => {
    const input = {
      parents: ['pick:v3:' + 'a'.repeat(64), 'pick:v3:' + 'b'.repeat(64)],
      stateId: 'warp:state',
      actor: 'agent-b',
      authoredBy: { agentId: 'agent-b' },
      intent: 'resolve knot — granted',
      recordedAt: T0,
      objectCount: 1,
      delta: EMPTY_DELTA,
      provenance: { ref: 'refs/heads/selvage', treeSha: null as string | null, gitCommit: null as string | null },
      resolves: RESOLUTION,
      binding: { treeId: 'tree:' + 'c'.repeat(64) },
    };
    const bare = buildStrandV3(input);
    const granted = buildStrandV3({ ...input, underGrant: 'grant:' + '1'.repeat(64) });
    const regranted = buildStrandV3({ ...input, underGrant: 'grant:' + '2'.repeat(64) });
    expect(granted.pickId).not.toBe(bare.pickId);
    expect(regranted.pickId).not.toBe(granted.pickId);
    expect(granted.underGrant).toBe('grant:' + '1'.repeat(64));
    // absent input = the field is ABSENT from strand and preimage alike —
    // deterministic: rebuilding without it reproduces the bare id exactly.
    expect(buildStrandV3(input).pickId).toBe(bare.pickId);
    expect('underGrant' in bare).toBe(false);
  });

  it('v3 construction refuses underGrant without resolves (grants cover RESOLVE only)', () => {
    expect(() =>
      buildStrandV3({
        parents: ['pick:v3:' + 'a'.repeat(64)],
        stateId: 'warp:state',
        actor: 'agent-b',
        intent: 'ordinary pick',
        recordedAt: T0,
        objectCount: 1,
        delta: EMPTY_DELTA,
        provenance: { ref: 'refs/heads/selvage', treeSha: null, gitCommit: null },
        underGrant: 'grant:' + '1'.repeat(64),
        binding: { treeId: 'tree:' + 'c'.repeat(64) },
      }),
    ).toThrow(/underGrant without resolves/);
  });
});

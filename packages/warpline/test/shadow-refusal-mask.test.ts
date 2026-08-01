/**
 * shadow-refusal-mask.test — C-16 (soundness audit 2026-07-31, Jinx J-12):
 * "shadow refusals are masked as success".
 *
 * The shadow gate answers `{shadow:true, row, result}` (daemon/server.ts), so a
 * refusing verdict lives at `result.result.refusal` — one level down. Both the
 * daemon's PW-8 audit probe and the MCP skin's isError probe tested
 * `'refusal' in result` on the OUTER object, so a shadow CLAIM_BREACH /
 * TRUST_HELD / KNOT reached the MCP host as `isError:false` and audited as a
 * clean ok with no resultCode — precisely the masking class the PW-8 comment
 * directly above it claims to have closed.
 *
 * It matters past the audit: the shadow gate is how R2 observes what it WOULD
 * have decided, and the shadow verdict stream is the evidence base for the
 * gate-promotion argument. A masked refusal corrupts the observation.
 *
 * Pinned here:
 *   UNIT       `refusalOf` — the single accessor both call sites now share —
 *              finds a refusal at BOTH legal depths, survives a JSON round
 *              trip, and refuses look-alikes, absent values and depths it must
 *              not reach. It is the single point of failure for both skins, so
 *              it is tested directly and adversarially.
 *   MCP        a shadow-path refusal surfaces to the host as isError:true, with
 *              the refusal intact inside the verbatim envelope; a shadow-path
 *              SUCCESS still surfaces as isError:false.
 *   AUDIT      the daemon audit records the shadow refusal's code
 *              (`resultCode`) instead of a clean row; a shadow success records
 *              no resultCode.
 *   UNCHANGED  the NON-shadow path behaves exactly as before (the same verdict
 *              through the direct shape is still isError:true + resultCode) —
 *              the fix must not have moved the control.
 *   TRACE      the f4Trace row for the shadow call carries the refusal (F4
 *              ground truth reads these rows).
 *
 * NOTE ON `ok` (reported to the coordinator, deliberately NOT decided here):
 * daemonAudit `ok` means "the dispatch produced a result", and PW-8's answer to
 * "ok:true masks refusals" was the additive `resultCode` field, not flipping
 * `ok`. The non-shadow path audits a CLAIM-BREACH as `ok:true` + resultCode,
 * and mcp-skin.test.ts pins the same for the f4 trace. These tests therefore
 * assert that the shadow row is INDISTINGUISHABLE from the non-shadow row in
 * refusal visibility, which is the invariant C-16 actually broke. If the
 * founder wants `ok:false` for verdict-class refusals, that is a change to BOTH
 * paths, not a shadow-only special case.
 *
 * FIXTURES ONLY — never the live repo fabric (hard rule).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { startDaemon, readDaemonAudit, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken, writeMcpTokenFile } from '../src/daemon/tokens.js';
import { readF4Trace } from '../src/daemon/f4-trace.js';
import { createClaim, persistClaim } from '../src/fabric/claim.js';
import { refusalOf, refuse, REFUSAL_SCHEMA, type Refusal } from '../src/fabric/refusal.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

function bodyOf(r: ToolResult): Record<string, unknown> {
  expect(r.content).toHaveLength(1);
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

/* ── UNIT: the single accessor ───────────────────────────────────────────────── */

describe('#refusal — refusalOf knows both depths and nothing else (C-16)', () => {
  const claimBreach = refuse({ code: 'CLAIM_BREACH' });
  const gateRefused = refuse({ code: 'GATE_REFUSED' });

  it('DEPTH 1 — the engine shape carries its own refusal', () => {
    expect(refusalOf({ sealed: false, refusal: claimBreach })).toBe(claimBreach);
  });

  it('DEPTH 2 — the shadow envelope nests the engine shape under `result`', () => {
    const shadowEnvelope = { shadow: true, row: { status: 'CLAIM-BREACH' }, result: { sealed: false, refusal: claimBreach } };
    expect(refusalOf(shadowEnvelope)).toBe(claimBreach);
    // ...and after the wire round-trip the daemon and the MCP host both perform
    expect(refusalOf(JSON.parse(JSON.stringify(shadowEnvelope)) as unknown)?.code).toBe('CLAIM_BREACH');
  });

  it('a shadow envelope carrying a NON-refusing result yields nothing', () => {
    expect(refusalOf({ shadow: true, row: { status: 'FAST_ADMIT' }, result: { sealed: false } })).toBeUndefined();
  });

  it('the outer refusal wins when both depths carry one', () => {
    expect(refusalOf({ refusal: gateRefused, result: { refusal: claimBreach } })).toBe(gateRefused);
  });

  it('rejects look-alikes: an unversioned object on a `refusal` key is not a verdict', () => {
    expect(refusalOf({ refusal: { code: 'CLAIM_BREACH' } })).toBeUndefined();
    expect(refusalOf({ refusal: { schemaVersion: 'refusal:v2', code: 'CLAIM_BREACH' } })).toBeUndefined();
    expect(refusalOf({ refusal: { schemaVersion: REFUSAL_SCHEMA } })).toBeUndefined(); // no code
  });

  it('rejects absent / non-object inputs without throwing', () => {
    for (const v of [undefined, null, 0, '', 'refusal', [], {}, { refusal: undefined }, { result: null }]) {
      expect(refusalOf(v)).toBeUndefined();
    }
  });

  it('is BOUNDED at one envelope level — it never deep-searches an arbitrary result', () => {
    // a refusal two envelopes down is NOT this caller's outcome; finding it
    // would turn unrelated reads into errors.
    expect(refusalOf({ result: { result: { refusal: claimBreach } } })).toBeUndefined();
    // nor does it dig through sibling collections (e.g. a tail of shadow rows)
    expect(refusalOf({ rows: [{ refusal: claimBreach }], total: 1 })).toBeUndefined();
  });
});

/* ── END TO END: daemon + MCP skin over a fixture fabric ─────────────────────── */

describe('#warpline-mcp / #warplined — a shadow refusal is never masked (C-16)', () => {
  let root: string;
  let handle: DaemonHandle;
  let mcp: Client;
  let skinClose: () => void;
  let narrowClaimId: string;
  const savedEnvToken = process.env.WARPLINE_MCP_TOKEN;

  const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
    mcp.callTool({ name, arguments: args }) as Promise<ToolResult>;

  /** daemon audit rows for `admit`, in order. */
  const admitAudit = (): ReturnType<typeof readDaemonAudit> => readDaemonAudit(root).filter((r) => r.verb === 'admit');

  beforeAll(async () => {
    delete process.env.WARPLINE_MCP_TOKEN; // discovery must go through the file
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wlc16-'));
    write(root, MOD, BASE);
    const agent = mintToken(root, 'mcp', 'agent');
    writeMcpTokenFile(root, agent.token);
    handle = await startDaemon(root);

    const skin = await buildMcpServer({ root, autoStart: false });
    skinClose = skin.close;
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await skin.server.connect(st);
    mcp = new Client({ name: 'c16-client', version: '0.0.0' });
    await mcp.connect(ct);

    // genesis, through the tools, so the fabric has a selvage to judge against
    await call('warpline_fork');
    await call('warpline_propose', { intent: 'genesis', worktree: root });
    const genesis = await call('warpline_admit', { worktree: root, noRestore: true });
    expect((bodyOf(genesis) as { sealed?: boolean }).sealed).toBe(true);

    // a deliberately-too-narrow claim + a worktree edit ⇒ every admission judged
    // under it is a CLAIM-BREACH, on the shadow path and the direct path alike.
    write(root, MOD, BASE.replace('return 1', 'return 42'));
    const claim = createClaim({ agentId: 'mcp', claimedSymbols: ['#not-a-real-symbol'], intent: 'narrow claim' });
    persistClaim(root, claim);
    narrowClaimId = claim.claimId;
  }, 120_000);

  afterAll(async () => {
    if (savedEnvToken !== undefined) process.env.WARPLINE_MCP_TOKEN = savedEnvToken;
    await mcp?.close().catch(() => {});
    skinClose?.();
    await handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 30_000);

  it('a SHADOW refusal reaches the MCP host as isError:true, refusal intact one level down', async () => {
    const r = await call('warpline_admit', { worktree: root, shadow: true, claim: narrowClaimId });

    // THE C-16 ASSERTION: before the fix this was `false` — a refusing verdict
    // presenting to the host as a clean success.
    expect(r.isError).toBe(true);

    // the envelope is still VERBATIM (§2): nothing unwrapped, nothing promoted
    const body = bodyOf(r) as { shadow?: boolean; row?: { status?: string }; result?: { refusal?: Refusal } };
    expect(body.shadow).toBe(true);
    expect(body.row!.status).toBe('CLAIM-BREACH');
    expect(body.result!.refusal!.schemaVersion).toBe('refusal:v1');
    expect(body.result!.refusal!.code).toBe('CLAIM_BREACH');
  }, 60_000);

  it('the daemon AUDIT records the shadow refusal code instead of a clean row', () => {
    const shadowRows = admitAudit().filter((r) => r.target?.includes('shadow'));
    expect(shadowRows.length).toBeGreaterThanOrEqual(1);
    const last = shadowRows[shadowRows.length - 1]!;
    expect(last.principal).toBe('mcp');
    // THE C-16 ASSERTION: before the fix, resultCode was absent — the row was
    // indistinguishable from a shadow admission that sealed nothing cleanly.
    expect(last.resultCode).toBe('CLAIM_BREACH');
    // `ok` still means "the dispatch produced a result" — see the header note.
    expect(last.ok).toBe(true);
  });

  it('the f4Trace row for the shadow call carries the refusal (F4 ground truth)', () => {
    const shadowTrace = readF4Trace(root).filter((r) => r.verb === 'admit' && r.target?.includes('shadow'));
    expect(shadowTrace.length).toBeGreaterThanOrEqual(1);
    const last = shadowTrace[shadowTrace.length - 1]!;
    expect(last.refusal?.code).toBe('CLAIM_BREACH');
    expect(last.refusal?.gate).toBe('claim');
  });

  it('a SHADOW SUCCESS is still a success: isError:false, audited ok with NO resultCode', async () => {
    const before = admitAudit().length;
    const r = await call('warpline_admit', { worktree: root, shadow: true }); // no claim ⇒ no breach

    const body = bodyOf(r) as { shadow?: boolean; row?: { status?: string }; result?: { refusal?: Refusal } };
    expect(body.shadow).toBe(true);
    expect(body.result!.refusal).toBeUndefined(); // precondition: this verdict does not refuse
    expect(r.isError ?? false).toBe(false); // …so the host must NOT see an error

    const rows = admitAudit();
    expect(rows.length).toBe(before + 1);
    const last = rows[rows.length - 1]!;
    expect(last.ok).toBe(true);
    expect(last.resultCode).toBeUndefined();
  }, 60_000);

  it('CONTROL — the NON-shadow path is unchanged: same verdict, same isError, same audit shape', async () => {
    // the direct path needs a sealed proposal to judge (the shadow path reads the
    // worktree); everything else about the admission is identical.
    await call('warpline_fork');
    const p = await call('warpline_propose', { intent: 'foo → 42 under the narrow claim', worktree: root });
    expect(p.isError ?? false).toBe(false);

    const r = await call('warpline_admit', { worktree: root, claim: narrowClaimId, noRestore: true });

    expect(r.isError).toBe(true);
    const body = bodyOf(r) as { sealed?: boolean; decision?: { status: string }; refusal?: Refusal };
    expect(body.sealed).toBe(false);
    expect(body.decision!.status).toBe('CLAIM-BREACH');
    expect(body.refusal!.code).toBe('CLAIM_BREACH'); // depth 1, as it always was

    const direct = admitAudit().filter((x) => !x.target?.includes('shadow'));
    const last = direct[direct.length - 1]!;
    expect(last.ok).toBe(true);
    expect(last.resultCode).toBe('CLAIM_BREACH');

    // THE INVARIANT C-16 BROKE: the same verdict is equally visible in the audit
    // whether it was observed (shadow) or enforced (direct).
    const shadowRows = admitAudit().filter((x) => x.target?.includes('shadow') && x.resultCode);
    expect(shadowRows[shadowRows.length - 1]!.resultCode).toBe(last.resultCode);
    expect(shadowRows[shadowRows.length - 1]!.ok).toBe(last.ok);
  }, 60_000);
});

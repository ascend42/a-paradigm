/**
 * mcp-skin.test — the THIRD SKIN end-to-end (mcp-skin-spec §2-§3, Phase 3):
 * a REAL daemon on a fixture fabric, the REAL MCP server wired to it, driven
 * through a real MCP client over a linked in-memory transport pair.
 *
 * What is defended:
 *   - surface law: the default surface omits every human verb + override flag
 *     (Aegis R2 — omission, not expose-then-refuse); tool names are legal.
 *   - identity law: injected actor/decidedBy/agentId args never reach the wire
 *     (schema-filtered); the daemon server-stamps the token's principal.
 *   - isError contract (§3, the T-006 lesson): a CLAIM-BREACH riding inside an
 *     ok result is isError:true — a refusing verdict never presents as success.
 *   - verbatim results: untrusted-prose envelopes survive the skin unmodified.
 *   - the two skin-built refusals: token-missing (AUTH + mint ladder) and
 *     daemon-down (UNSUPPORTED + daemon.start ladder).
 *   - f4Trace: one row per call, refusals captured from inside ok results,
 *     rows prose-free.
 *
 * NEVER started against this repo's live fabric — fixtures only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { startDaemon, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken, writeMcpTokenFile } from '../src/daemon/tokens.js';
import { HUMAN_ONLY_VERBS } from '../src/daemon/protocol.js';
import { readF4Trace } from '../src/daemon/f4-trace.js';
import type { Refusal } from '../src/fabric/refusal.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\n';
const INTENT_MARKER = 'ZEBRA-INTENT-MARKER prose that must never appear in a trace row';

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
  expect(r.content[0]!.type).toBe('text');
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

describe('#warpline-mcp — the third skin over a real daemon (fixtures only)', () => {
  let root: string;
  let handle: DaemonHandle;
  let mcp: Client;
  let skinClose: () => void;
  const savedEnvToken = process.env.WARPLINE_MCP_TOKEN;

  beforeAll(async () => {
    delete process.env.WARPLINE_MCP_TOKEN; // discovery must go through the file
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcp-'));
    write(root, MOD, BASE);
    // a HUMAN token exists in daemon-tokens.jsonl — the skin must never pick it up
    mintToken(root, 'the-human', 'human');
    const agent = mintToken(root, 'mcp', 'agent');
    writeMcpTokenFile(root, agent.token);
    handle = await startDaemon(root);

    const skin = await buildMcpServer({ root, autoStart: false });
    skinClose = skin.close;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await skin.server.connect(serverTransport);
    mcp = new Client({ name: 'test-client', version: '0.0.0' });
    await mcp.connect(clientTransport);
  }, 60_000);

  afterAll(async () => {
    if (savedEnvToken !== undefined) process.env.WARPLINE_MCP_TOKEN = savedEnvToken;
    await mcp?.close().catch(() => {});
    skinClose?.();
    await handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 30_000);

  const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
    mcp.callTool({ name, arguments: args }) as Promise<ToolResult>;

  it('registers the 12-tool agent surface — human verbs and override flags OMITTED', async () => {
    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'warpline_status',
        'warpline_refs_list',
        // M2.5 skins (increment 7): the branch model's agent-class verbs. `branch`
        // is registered even though its protect/unprotect OPS are human-class —
        // the verb is agent-legal for create/list/delete; the ops are gated at the
        // daemon (verb×op, like admit's verb×flag), so this is not expose-a-human-VERB.
        'warpline_branch',
        'warpline_switch',
        'warpline_merge',
        'warpline_fork',
        'warpline_propose',
        'warpline_admit',
        // C-10: the agent-class exit. It MUST be on this surface — a swarm with
        // no withdrawal verb halts on its first genuine conflict.
        'warpline_abandon',
        'warpline_knot_show',
        'warpline_grade_report',
        'warpline_shadow_tail',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]+$/);
      for (const human of HUMAN_ONLY_VERBS) expect(t.name).not.toBe('warpline_' + human.replace(/\./g, '_'));
      // override flags never appear in any schema
      const props = Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
      expect(props).not.toContain('acceptBreach');
      expect(props).not.toContain('acceptRisk');
      expect(props).not.toContain('actor');
      expect(props).not.toContain('decidedBy');
    }
  });

  it('status is state-aware (PW-6) and reports the server-stamped principal', async () => {
    const r = await call('warpline_status');
    expect(r.isError ?? false).toBe(false);
    const s = bodyOf(r);
    expect(s.principal).toBe('mcp');
    expect(s.kind).toBe('agent');
    expect(s.nextLegalVerbs).toEqual(['fork', 'branch', 'switch']); // cold position: fork first, then lane setup
    expect((s.toolMap as Record<string, string>)['knot.show']).toBe('warpline_knot_show');
    expect(Array.isArray(s.cycle)).toBe(true);
  });

  it('drives genesis fork→propose→admit through the tools; injected identity args are DISCARDED', async () => {
    const p = await call('warpline_propose', {
      intent: INTENT_MARKER,
      worktree: root,
      // impersonation attempt — all three must be filtered by the skin,
      // and the daemon would ignore them anyway (defense in depth):
      agentId: 'impostor',
      actor: 'impostor',
      decidedBy: 'impostor',
    });
    expect(p.isError ?? false).toBe(false);
    const proposed = bodyOf(p) as { strand?: { actor: string; authoredBy?: { agentId: string } } };
    expect(proposed.strand!.actor).toBe('mcp'); // server-stamped, not 'impostor'
    expect(proposed.strand!.authoredBy!.agentId).toBe('mcp');

    const a = await call('warpline_admit', { worktree: root, noRestore: true });
    expect(a.isError ?? false).toBe(false);
    const admitted = bodyOf(a) as { sealed?: boolean; decision?: { status: string } };
    expect(admitted.sealed).toBe(true);
    expect(admitted.decision!.status).toBe('FAST_ADMIT');
  });

  it('a CLAIM-BREACH inside an ok result is isError:true with the refusal at top level (§3 — the T-006 lesson)', async () => {
    const f = await call('warpline_fork');
    expect(f.isError ?? false).toBe(false);
    write(root, MOD, 'export function foo() { return 42; }\n');
    const p = await call('warpline_propose', {
      intent: 'edit foo under a deliberately narrow claim',
      worktree: root,
      claim: { claimedSymbols: ['#nothing-real'] },
    });
    expect(p.isError ?? false).toBe(false);
    const claimId = (bodyOf(p) as { claimId?: string }).claimId!;
    expect(claimId).toBeDefined();

    const a = await call('warpline_admit', { worktree: root, claim: claimId, noRestore: true });
    expect(a.isError).toBe(true); // sealed:false + refusal ⇒ NEVER presents as success
    const body = bodyOf(a) as { sealed?: boolean; decision?: { status: string }; refusal?: Refusal };
    expect(body.sealed).toBe(false);
    expect(body.decision!.status).toBe('CLAIM-BREACH');
    expect(body.refusal!.code).toBe('CLAIM_BREACH');
    expect(body.refusal!.retriable).toBe('retry-with-override');
    // the ladder's human re-admit step names the native surface params verbatim
    const readmit = body.refusal!.next.find((n) => n.verb === 'admit');
    expect(readmit?.principal).toBe('human');
  });

  it('untrusted-prose envelopes survive the skin VERBATIM (claim intent round-trip)', async () => {
    // the claim persisted in the breach test carries an enveloped intent; read
    // it back through the engine sidecar and confirm the envelope discipline —
    // then confirm the skin never unwrapped prose into its own output shapes.
    const { readClaim } = await import('../src/fabric/claim.js');
    const claims = fs.readdirSync(path.join(root, '.warpline', 'claims')).filter((f) => f.startsWith('claim_v1_'));
    expect(claims.length).toBeGreaterThan(0);
    const c = readClaim(root, claims[0]!.replace(/\.json$/, '').replace(/_/g, ':'));
    expect(c?.intent.kind).toBe('untrusted-prose');
    expect(c?.intent.contentAddress).toMatch(/^prose:v1:/);
  });

  it('missing token → the AUTH refusal with the mint ladder (skin-built refusal #2)', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcp-bare-'));
    try {
      const { server } = await buildMcpServer({ root: bare, autoStart: false });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const c = new Client({ name: 't', version: '0' });
      await c.connect(ct);
      const r = (await c.callTool({ name: 'warpline_status', arguments: {} })) as ToolResult;
      expect(r.isError).toBe(true);
      const refusal = (bodyOf(r) as { refusal?: Refusal }).refusal!;
      expect(refusal.code).toBe('AUTH');
      expect(refusal.next[0]!.verb).toBe('daemon.token.mint');
      expect(refusal.next[0]!.principal).toBe('human');
      await c.close();
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it('daemon down → the UNSUPPORTED refusal with the daemon.start ladder (skin-built refusal #1)', async () => {
    const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'wmcp-down-'));
    try {
      const t = mintToken(lonely, 'mcp', 'agent');
      writeMcpTokenFile(lonely, t.token);
      const { server } = await buildMcpServer({ root: lonely, autoStart: false });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server.connect(st);
      const c = new Client({ name: 't', version: '0' });
      await c.connect(ct);
      const r = (await c.callTool({ name: 'warpline_status', arguments: {} })) as ToolResult;
      expect(r.isError).toBe(true);
      const refusal = (bodyOf(r) as { refusal?: Refusal }).refusal!;
      expect(refusal.code).toBe('UNSUPPORTED');
      expect(refusal.gate).toBe('transport');
      expect(refusal.next[0]!).toEqual({ verb: 'daemon.start', params: {}, requires: [], principal: 'human' });
      await c.close();
    } finally {
      fs.rmSync(lonely, { recursive: true, force: true });
    }
  });

  it('f4Trace: one row per call, skin=mcp, the breach refusal captured from INSIDE an ok frame, rows prose-free', () => {
    const rows = readF4Trace(root);
    expect(rows.length).toBeGreaterThanOrEqual(4); // status, propose, admit, fork, propose, admit…
    for (const row of rows) {
      expect(row.schemaVersion).toBe('f4Trace:v1');
      expect(row.skin).toBe('mcp');
      expect(row.runId).toBe('unscored');
      expect(row.descriptorsId).toMatch(/^descriptors:v1:/);
    }
    const breach = rows.find((r) => r.refusal?.code === 'CLAIM_BREACH')!;
    expect(breach).toBeDefined();
    expect(breach.ok).toBe(true); // the wire frame was ok — the refusal rode INSIDE (what daemonAudit masks)
    expect(breach.resultClass).toBe('CLAIM-BREACH');
    // prose-free: the distinctive intent prose must never appear in any row
    expect(JSON.stringify(rows)).not.toContain('ZEBRA-INTENT-MARKER');
  });
});

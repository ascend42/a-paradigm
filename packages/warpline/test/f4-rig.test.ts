/**
 * f4-rig.test — the harness rig END-TO-END (T-2026-07-21-005, build side):
 * a seeded world + the scripted rival + a SCRIPTED subject driven through the
 * REAL MCP skin, classified from the REAL f4Trace rows. This is the full
 * measurement pipeline minus only the cold model itself — proving that when
 * FG-1..FG-4 are signed, scoring is running this loop with a model in the
 * subject's seat.
 *
 * The scripted subject deliberately makes the two canonical cold mistakes
 * (admit before propose; identical re-admit after a KNOT) so the pipeline
 * demonstrates: PW-2 refusals over the full stack, KNOT production via the
 * rival, hydration via next[0], and the classifier's verdict on the whole
 * transcript.
 *
 * NEVER against the live fabric — scratch fixture only (isolation law).
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
import { seedWorld, rivalAdvance } from '../src/f4/seed.js';
import { classifyRun } from '../src/f4/classifier.js';
import { readF4Trace } from '../src/daemon/f4-trace.js';
import type { Refusal } from '../src/fabric/refusal.js';

const SUBJECT_EDIT = 'export function pivot() { return 7; }\nexport function caller() { return pivot() + 1; }\n';

interface ToolResult {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
}

describe('#f4-rig — seeded world → scripted subject over the MCP skin → classified transcript', () => {
  let root: string;
  let file: string;
  let handle: DaemonHandle;
  let mcp: Client;
  let skinClose: () => void;
  const savedRunId = process.env.WARPLINE_F4_RUN_ID;
  const savedToken = process.env.WARPLINE_MCP_TOKEN;

  beforeAll(async () => {
    delete process.env.WARPLINE_MCP_TOKEN;
    process.env.WARPLINE_F4_RUN_ID = 'rig-proof-001';
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wf4rig-'));
    ({ file } = await seedWorld({ root }));
    mintToken(root, 'the-human', 'human');
    const agent = mintToken(root, 'subject', 'agent');
    writeMcpTokenFile(root, agent.token);
    handle = await startDaemon(root);
    const skin = await buildMcpServer({ root, autoStart: false });
    skinClose = skin.close;
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await skin.server.connect(st);
    mcp = new Client({ name: 'rig', version: '0' });
    await mcp.connect(ct);
  }, 60_000);

  afterAll(async () => {
    if (savedRunId !== undefined) process.env.WARPLINE_F4_RUN_ID = savedRunId;
    else delete process.env.WARPLINE_F4_RUN_ID;
    if (savedToken !== undefined) process.env.WARPLINE_MCP_TOKEN = savedToken;
    await mcp?.close().catch(() => {});
    skinClose?.();
    await handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 30_000);

  const call = (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> =>
    mcp.callTool({ name, arguments: args }) as Promise<ToolResult>;
  const bodyOf = (r: ToolResult): Record<string, unknown> => JSON.parse(r.content[0]!.text) as Record<string, unknown>;

  it('runs the scripted transcript and the classifier renders the expected verdict', async () => {
    // 1. orient — position: nothing forked, nextLegalVerbs [fork, branch, switch]
    // (fork FIRST — the cycle's step 1; M2.5 skins add the lane-setup verbs after).
    const s = await call('warpline_status');
    expect((bodyOf(s) as { nextLegalVerbs?: string[] }).nextLegalVerbs).toEqual(['fork', 'branch', 'switch']);

    // 2. COLD MISTAKE #1 — admit before propose: PW-2 over the full stack
    const early = await call('warpline_admit', { worktree: root, noRestore: true });
    expect(early.isError).toBe(true);
    const earlyRefusal = (bodyOf(early) as { refusal?: Refusal }).refusal!;
    expect(earlyRefusal.code).toBe('BAD_REQUEST');
    expect(earlyRefusal.retriable).toBe('retry-corrected');
    expect(earlyRefusal.next.map((n) => n.verb)).toEqual(['fork', 'propose']);

    // 3. follow the ladder: fork → edit → propose
    expect((await call('warpline_fork')).isError ?? false).toBe(false);
    fs.writeFileSync(path.join(root, file), SUBJECT_EDIT, 'utf8');
    const p = await call('warpline_propose', { intent: 'subject: pivot returns 7', worktree: root });
    expect(p.isError ?? false).toBe(false);

    // 4. the scripted RIVAL advances the selvage underneath the subject
    const rival = await rivalAdvance({ root, file });
    expect(rival.sealed).toBe(true);

    // 5. the subject's admit now KNOTs — refusal with a dereferenceable payload
    const a = await call('warpline_admit', { worktree: root, noRestore: true });
    expect(a.isError).toBe(true);
    const knotRefusal = (bodyOf(a) as { refusal?: Refusal }).refusal!;
    expect(knotRefusal.code).toBe('GATE_REFUSED');
    expect(knotRefusal.verdict).toBe('KNOT');
    const payloadId = knotRefusal.pointers.knotPayloadId!;
    expect(payloadId).toBeDefined();

    // 6. hydrate the work order via next[0] (summary bound — PW-7)
    const k = await call('warpline_knot_show', { selector: payloadId, summary: true });
    expect(k.isError ?? false).toBe(false);
    const payload = bodyOf(k) as { summary?: boolean; contested?: Array<{ ours: { fileText: string | null } }> };
    expect(payload.summary).toBe(true);
    expect(payload.contested!.every((c) => c.ours.fileText === null)).toBe(true);

    // 7. COLD MISTAKE #2 — identical re-admit (the KNOT stands)
    const again = await call('warpline_admit', { worktree: root, noRestore: true });
    expect(again.isError).toBe(true);

    // 8. CLASSIFY the real transcript
    const rows = readF4Trace(root).filter((r) => r.runId === 'rig-proof-001');
    const report = classifyRun(rows);
    expect(report.runId).toBe('rig-proof-001');
    expect(report.skins).toEqual(['mcp']);
    expect(report.descriptorsIds).toHaveLength(1); // FG-3 validity precondition
    // two episodes: the surface miss (closed by the KNOT admit) + the KNOT
    expect(report.episodes).toHaveLength(2);
    const [e1, e2] = report.episodes;
    expect(e1!.refusal.code).toBe('BAD_REQUEST');
    expect(e1!.wasted.map((w) => w.rule)).toEqual(['W4']); // the miss itself; ladder-following added none
    expect(e1!.closedAtSeq).not.toBeNull();
    expect(e2!.refusal.code).toBe('GATE_REFUSED');
    expect(e2!.wasted.map((w) => w.rule)).toEqual(['W1']); // the identical re-admit
    expect(e2!.closedAtSeq).toBeNull(); // resolution is human-class — run ends held
    expect(report.medianWastedPerRecovery).toBe(1);
    expect(report.surfaceMisses).toBe(1);
    expect(report.unresolvedEpisodes).toBe(1);
  }, 120_000);
});

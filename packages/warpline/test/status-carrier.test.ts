/**
 * status-carrier.test — the PW-6 orientation carrier over the REAL skin, and
 * the regression for FG-3 finding 2 (review of 2026-07-28).
 *
 * `status` is the load-bearing F4 carrier: hosts truncate tool descriptions to
 * names-only, but nothing truncates a RESULT, so a cold agent re-orients here.
 * The classifier grants exactly one orientation call per recovery episode
 * BECAUSE cold agents legitimately re-orient — which makes a WRONG answer here
 * expensive: it spends the allowance and walks the agent into a wasted turn.
 *
 * The defect this pins: after a KNOT, the carrier answered nextLegalVerbs
 * ['admit'] — contradicting the refusal's own ladder (knot.show, then a
 * HUMAN-class resolve) and steering the agent into the identical re-admit the
 * classifier scores W1. Probed live before the fix; asserted here after.
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
import type { Refusal } from '../src/fabric/refusal.js';

const SUBJECT_EDIT = 'export function pivot() { return 7; }\nexport function caller() { return pivot() + 1; }\n';

interface StatusBody {
  nextLegalVerbs: string[];
  nextBecause: string;
  position: { scratchPresent: boolean; proposalSealed: boolean; behindSelvage: boolean; knotOpen: boolean };
}

describe('#warplined status — the orientation carrier tracks the cycle, including the KNOT door', () => {
  let root: string;
  let file: string;
  let handle: DaemonHandle;
  let mcp: Client;
  let skinClose: () => void;
  const savedToken = process.env.WARPLINE_MCP_TOKEN;

  beforeAll(async () => {
    delete process.env.WARPLINE_MCP_TOKEN;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wstatus-'));
    ({ file } = await seedWorld({ root }));
    mintToken(root, 'the-human', 'human');
    writeMcpTokenFile(root, mintToken(root, 'subject', 'agent').token);
    handle = await startDaemon(root);
    const skin = await buildMcpServer({ root, autoStart: false });
    skinClose = skin.close;
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await skin.server.connect(st);
    mcp = new Client({ name: 'status-carrier', version: '0' });
    await mcp.connect(ct);
  }, 60_000);

  afterAll(async () => {
    if (savedToken !== undefined) process.env.WARPLINE_MCP_TOKEN = savedToken;
    await mcp?.close().catch(() => {});
    skinClose?.();
    await handle?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }, 30_000);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await mcp.callTool({ name, arguments: args })) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    return { isError: r.isError ?? false, body: JSON.parse(r.content[0]!.text) as Record<string, unknown> };
  };
  const status = async (): Promise<StatusBody> => (await call('warpline_status')).body as unknown as StatusBody;

  it('walks fork → propose → KNOT and never points a contested agent back at admit', async () => {
    // cold: nothing minted.
    const cold = await status();
    expect(cold.nextLegalVerbs).toEqual(['fork']);
    expect(cold.position.knotOpen).toBe(false);

    // forked but nothing sealed.
    await call('warpline_fork');
    const forked = await status();
    expect(forked.nextLegalVerbs).toEqual(['propose']);

    // sealed, unjudged.
    fs.writeFileSync(path.join(root, file), SUBJECT_EDIT, 'utf8');
    await call('warpline_propose', { intent: 'subject: pivot returns 7', worktree: root });
    const proposed = await status();
    expect(proposed.nextLegalVerbs).toEqual(['admit']);
    expect(proposed.position.proposalSealed).toBe(true);
    expect(proposed.position.behindSelvage).toBe(false);

    // the rival advances underneath: still admit — discovering CLEAN vs KNOT
    // is exactly what the first admit is FOR.
    await rivalAdvance({ root, file });
    const stale = await status();
    expect(stale.position.behindSelvage).toBe(true);
    expect(stale.nextLegalVerbs).toEqual(['admit']);
    expect(stale.position.knotOpen).toBe(false);

    // the admit KNOTs.
    const a = await call('warpline_admit', { worktree: root, noRestore: true });
    expect(a.isError).toBe(true);
    const refusal = (a.body as { refusal?: Refusal }).refusal!;
    expect(refusal.verdict).toBe('KNOT');

    // THE REGRESSION: the carrier must now agree with the refusal's ladder.
    const knotted = await status();
    expect(knotted.position.knotOpen).toBe(true);
    expect(knotted.nextLegalVerbs).toEqual(['knot.show']);
    expect(knotted.nextLegalVerbs).not.toContain('admit');
    // and it must say WHY, or the agent has no reason not to retry.
    expect(knotted.nextBecause).toMatch(/escalate|human/i);

    // the carrier and the ladder now name the same next step.
    expect(refusal.next[0]!.verb).toBe('knot.show');
  }, 180_000);
});

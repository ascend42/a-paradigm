/**
 * daemon-branch-skins.test — M2.5 skins INCREMENT 7 (TD-2026-08-12-813): the
 * branch model's three verbs exposed through the daemon + MCP surface, and the
 * DAEMON-SIDE PROTECTED-BRANCH LANDING GATE that increment 5 deferred (it noted
 * server.ts was out of its scope), now closed.
 *
 * Pinned here:
 *   DISPATCH   an AGENT token drives branch(create/list) → switch → a real
 *              fast-forward merge among FEATURE branches, entirely through the
 *              socket (git-absent fixture).
 *   THE GATE   an agent-class merge INTO a protected branch (selvage), and an
 *              agent-class admit INTO it, are REFUSED server-side (FORBIDDEN) —
 *              the laundering route closed on the daemon exactly as on the CLI.
 *              A HUMAN token integrates into selvage freely (the gate is
 *              principal-scoped, not a blanket block).
 *   HUMAN-OPS  branch protect/unprotect are human-class ops of the agent-class
 *              branch verb: refused for an agent, honored for a human.
 *   TEACHING   status teaches branch/switch/merge (verbs/cycle/toolMap) with the
 *              right principals + stages; the cold directive carrier names the
 *              lane verbs after `fork`.
 *   MCP        the three verbs are reachable as warpline_branch/switch/merge; the
 *              human-only `confirm` flag is OFF merge's schema (like admit's).
 *
 * NEVER started against this repo's live fabric — fixtures only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startDaemon, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken } from '../src/daemon/tokens.js';
import { DaemonClient, DaemonRpcError } from '../src/daemon/client.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { readRef } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { listProtected } from '../src/fabric/protected.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

async function rejectsWith(p: Promise<unknown>, code: string): Promise<DaemonRpcError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(DaemonRpcError);
    const e = err as DaemonRpcError;
    expect(e.code).toBe(code);
    expect(e.refusal?.schemaVersion).toBe('refusal:v1');
    expect(e.refusal?.code).toBe(code);
    return e;
  }
  throw new Error(`expected a DaemonRpcError(${code}) rejection, got a resolution`);
}

interface BranchInfo { name: string; pickId: string; current: boolean }
interface MergeResult { into: string; from: string; sealed?: boolean; fastForward?: boolean; alreadyUpToDate?: boolean }

describe('#warplined — branch/switch/merge skins + the daemon-side protected gate (increment 7)', () => {
  let root: string;
  let fx: string; // feature-x worktree
  let fy: string; // feature-y worktree
  let handle: DaemonHandle;
  let humanToken: string;
  let agentToken: string;
  let human: DaemonClient;
  let agent: DaemonClient;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-branch-skins-'));
    fx = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-branch-fx-'));
    fy = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-branch-fy-'));
    write(root, MOD, BASE);
    humanToken = mintToken(root, 'matt', 'human').token;
    agentToken = mintToken(root, 'agent-a', 'agent').token;
    handle = await startDaemon(root);
    human = await DaemonClient.connect(root, humanToken);
    agent = await DaemonClient.connect(root, agentToken);

    // GENESIS onto selvage — single line, so the protected gate is dormant
    // (branchingInUse:false) and this admits exactly as the pre-branch world did.
    await agent.fork();
    await agent.propose({ intent: 'genesis: the base module', worktree: root });
    const g = await agent.admit({ noRestore: true });
    expect(g.sealed).toBe(true);
  }, 60_000);

  afterAll(async () => {
    human?.close();
    agent?.close();
    await handle?.close();
    for (const d of [root, fx, fy]) fs.rmSync(d, { recursive: true, force: true });
  }, 30_000);

  it('(c) status teaches branch/switch/merge — right principals, stages, tool names, and the cold directive carrier', async () => {
    const s = await agent.status();
    expect(s.verbs).toEqual(expect.arrayContaining(['branch', 'switch', 'merge']));
    const byVerb = Object.fromEntries((s.cycle ?? []).map((c) => [c.verb, c]));
    // branch/switch/merge are all agent-class on the descriptor (protect/unprotect
    // + merge-confirm are human-only MODES enforced at the handler, not the verb).
    for (const v of ['branch', 'switch', 'merge'] as const) expect(byVerb[v]!.principal).toBe('agent');
    expect(byVerb['branch']!.stage).toBe('branch');
    expect(byVerb['switch']!.stage).toBe('branch');
    expect(byVerb['merge']!.stage).toBe('admit'); // merge runs the same seal core as admit
    expect(s.toolMap!['branch']).toBe('warpline_branch');
    expect(s.toolMap!['switch']).toBe('warpline_switch');
    expect(s.toolMap!['merge']).toBe('warpline_merge');
  });

  it('(a) an agent creates, lists, switches, and fast-forward-MERGEs among feature branches', async () => {
    const selvageTip = readRef(warplineDirOf(root), 'selvage');
    // create two feature lines at the current tip (agent-class).
    const cx = await agent.call<{ name: string; pickId: string }>('branch', { op: 'create', name: 'feature-x' });
    expect(cx.name).toBe('feature-x');
    expect(cx.pickId).toBe(selvageTip);
    await agent.call('branch', { op: 'create', name: 'feature-y' });

    // list (default op) — all three lines, selvage marked current (HEAD absent ≡ trunk).
    const listed = await agent.call<{ branches: BranchInfo[] }>('branch', { op: 'list' });
    const names = listed.branches.map((b) => b.name).sort();
    expect(names).toEqual(['feature-x', 'feature-y', 'selvage']);
    expect(listed.branches.find((b) => b.name === 'selvage')!.current).toBe(true);

    // switch onto feature-y (restores the tip's bytes into a fresh worktree, moves HEAD).
    const sw = await agent.call<{ branch: string; tip: string }>('switch', { name: 'feature-y', worktree: fy });
    expect(sw.branch).toBe('feature-y');
    expect(fs.readFileSync(path.join(fy, MOD), 'utf8')).toBe(BASE);

    // advance feature-y by one admit (HEAD is now feature-y, an agent-writable
    // feature line — not protected, so the landing gate passes).
    await agent.fork();
    write(fy, MOD, BASE.replace('return 1', 'return 10'));
    await agent.propose({ intent: 'y: foo returns 10', worktree: fy });
    const ay = await agent.admit({ worktree: fy, noRestore: true });
    expect(ay.sealed).toBe(true);
    const featureYTip = readRef(warplineDirOf(root), 'feature-y');
    expect(featureYTip).not.toBe(selvageTip); // feature-y moved ahead

    // MERGE feature-y INTO feature-x — both feature lines (neither protected), so
    // the agent may fold freely. feature-x is an ancestor of feature-y → fast-forward.
    const merged = await agent.call<MergeResult>('merge', { from: 'feature-y', into: 'feature-x', noRestore: true });
    expect(merged.into).toBe('feature-x');
    expect(merged.from).toBe('feature-y');
    expect(merged.sealed).toBe(true);
    expect(merged.fastForward).toBe(true);
    expect(readRef(warplineDirOf(root), 'feature-x')).toBe(featureYTip);
  });

  it('(b) THE DEFERRED GATE, CLOSED: an agent-class merge/admit INTO protected selvage is refused server-side', async () => {
    // selvage is protected by default, and branching is now in use (>1 line) — so
    // the daemon must refuse an agent-class landing onto it. This is the exact
    // laundering route (isolate on a solitary feature, clean-land into main).
    expect(listProtected(root)).toContain('selvage');

    // (b1) merge feature-y INTO selvage as the agent → FORBIDDEN, escalation ladder.
    const eMerge = await rejectsWith(
      agent.call('merge', { from: 'feature-y', into: 'selvage', noRestore: true }),
      'FORBIDDEN',
    );
    expect(eMerge.refusal?.retriable).toBe('never');
    expect(eMerge.refusal?.next?.[0]?.principal).toBe('human'); // the human path, not a self-retry
    // the ref never moved.
    const selvageBefore = readRef(warplineDirOf(root), 'selvage');

    // (b2) admit INTO selvage as the agent: switch HEAD onto selvage, then seal.
    // The admission targets the current branch (selvage) → the same FORBIDDEN.
    await agent.call('switch', { name: 'selvage', worktree: fx });
    await agent.fork();
    write(fx, MOD, BASE.replace('return 2', 'return 22'));
    await agent.propose({ intent: 'a: land straight onto main', worktree: fx });
    await rejectsWith(agent.admit({ worktree: fx, noRestore: true }), 'FORBIDDEN');

    // NEITHER refusal advanced selvage.
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(selvageBefore);

    // withdraw the agent's parked proposal so later blocks start clean.
    await agent.abandon();
  });

  it('(b+) the HUMAN integrates into protected selvage freely — the gate is principal-scoped', async () => {
    // A human token is human-class → the landing gate never engages. feature-y is
    // ahead of selvage → a fast-forward integration. This is the sanctioned path
    // the agent was told to escalate to.
    const merged = await human.call<MergeResult>('merge', { from: 'feature-y', into: 'selvage', noRestore: true });
    expect(merged.into).toBe('selvage');
    expect(merged.sealed).toBe(true);
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(readRef(warplineDirOf(root), 'feature-y'));
  });

  it('branch protect/unprotect are HUMAN-class ops of the branch verb — refused for an agent, honored for a human', async () => {
    // agent → FORBIDDEN before any registry mutation (verb×op, like admit's verb×flag).
    await rejectsWith(agent.call('branch', { op: 'protect', name: 'feature-x' }), 'FORBIDDEN');
    await rejectsWith(agent.call('branch', { op: 'unprotect', name: 'selvage' }), 'FORBIDDEN');
    expect(listProtected(root)).not.toContain('feature-x'); // no mutation ran

    // human → the registry actually changes, then reverts (net state unchanged).
    const protectedNow = await human.call<{ protected: string[]; changed: boolean }>('branch', {
      op: 'protect',
      name: 'feature-x',
    });
    expect(protectedNow.changed).toBe(true);
    expect(protectedNow.protected).toContain('feature-x');
    const readBack = await human.call<{ protected: string[] }>('branch', { op: 'list-protected' });
    expect(readBack.protected).toContain('feature-x');
    const reverted = await human.call<{ protected: string[] }>('branch', { op: 'unprotect', name: 'feature-x' });
    expect(reverted.protected).not.toContain('feature-x');
  });

  it('the three verbs are reachable through the MCP skin (warpline_branch/switch/merge); the human-only `confirm` flag is OFF merge', async () => {
    const saved = process.env.WARPLINE_MCP_TOKEN;
    process.env.WARPLINE_MCP_TOKEN = agentToken; // the skin holds a credential; the daemon stamps identity
    try {
      const skin = await buildMcpServer({ root, autoStart: false });
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await skin.server.connect(st);
      const c = new Client({ name: 't', version: '0' });
      await c.connect(ct);
      try {
        const { tools } = await c.listTools();
        const names = tools.map((t) => t.name);
        expect(names).toEqual(expect.arrayContaining(['warpline_branch', 'warpline_switch', 'warpline_merge']));

        // callable end-to-end through the skin → daemon → engine.
        const r = (await c.callTool({ name: 'warpline_branch', arguments: { op: 'list' } })) as {
          isError?: boolean;
          content: Array<{ text: string }>;
        };
        expect(r.isError ?? false).toBe(false);
        const body = JSON.parse(r.content[0]!.text) as { branches?: BranchInfo[] };
        expect(Array.isArray(body.branches)).toBe(true);

        // merge's schema exposes from/into but NOT the human-only `confirm`
        // override — mirrors admit's acceptBreach being off-schema (the skin can
        // never carry it to the wire from an agent).
        const mergeTool = tools.find((t) => t.name === 'warpline_merge')!;
        const props = Object.keys((mergeTool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {});
        expect(props).toContain('from');
        expect(props).toContain('into');
        expect(props).not.toContain('confirm');
        expect(props).not.toContain('acceptMeaningBlind');
      } finally {
        await c.close();
        skin.close();
      }
    } finally {
      if (saved === undefined) delete process.env.WARPLINE_MCP_TOKEN;
      else process.env.WARPLINE_MCP_TOKEN = saved;
    }
  }, 60_000);
});

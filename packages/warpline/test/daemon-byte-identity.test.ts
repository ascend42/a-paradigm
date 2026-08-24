/**
 * daemon-byte-identity.test — Loid R4 acceptance, pulled early into PHASE 1:
 * the SAME fixture admission run in-process vs through the daemon produces a
 * BYTE-IDENTICAL AdmitResult (modulo the transport envelope). The daemon adds
 * transport + identity, never logic — this test is the proof.
 *
 * Method: two fixture roots receive the IDENTICAL script (same file bytes,
 * same principals, same injected clocks). Root IP runs the engine functions
 * in-process; root D runs the same verbs through the socket. Every step's
 * result is compared as JSON bytes:
 *
 *   step A — genesis propose + admit (FAST_ADMIT fast-forward)
 *   step B — agent-x edit propose + admit (FAST_ADMIT, selvage advance)
 *   step C — agent-y disjoint edit propose + admit (CLEAN WEAVE — the real
 *            merge path: materializeMergedStateNative + weave seal + CAS)
 *
 * pickIds, stateIds, treeIds, deltas, decisions, coverage — all must agree
 * byte-for-byte, which also proves the daemon's server-stamped identity feeds
 * the engine EXACTLY what the CLI's --agent flag does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative } from '../src/fabric/native.js';
import { startDaemon, type DaemonHandle } from '../src/daemon/server.js';
import { mintToken } from '../src/daemon/tokens.js';
import { DaemonClient } from '../src/daemon/client.js';
import { listRefs } from '../src/fabric/refs.js';
import { warplineDirOf } from '../src/fabric/fabric.js';
import { verifyFabric } from '../src/fabric/verify.js';

const MOD = 'src/mod.ts';
const AUX = 'src/aux.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';
const AUX_BASE = 'export function aux() { return 0; }\n';

// Injected clocks — identical on both sides (determinism by construction).
const T = ['2026-07-17T10:00:01.000Z', '2026-07-17T10:00:02.000Z', '2026-07-17T10:00:03.000Z', '2026-07-17T10:00:04.000Z', '2026-07-17T10:00:05.000Z', '2026-07-17T10:00:06.000Z'];

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

const j = (v: unknown): string => JSON.stringify(v);

describe('#warplined — byte-identical verdicts: in-process vs through the daemon', () => {
  let rootIP: string; // in-process side
  let rootD: string; // daemon side
  let yIP: string; // agent-y worktrees
  let yD: string;
  let handle: DaemonHandle;
  let agentX: DaemonClient;
  let agentY: DaemonClient;

  beforeAll(async () => {
    rootIP = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-bip-'));
    rootD = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-bid-'));
    yIP = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-biyp-'));
    yD = fs.mkdtempSync(path.join(os.tmpdir(), 'wld-biyd-'));
    for (const r of [rootIP, rootD]) {
      write(r, MOD, BASE);
      write(r, AUX, AUX_BASE);
    }
    const tokX = mintToken(rootD, 'agent-x', 'agent').token;
    const tokY = mintToken(rootD, 'agent-y', 'agent').token;
    handle = await startDaemon(rootD);
    agentX = await DaemonClient.connect(rootD, tokX);
    agentY = await DaemonClient.connect(rootD, tokY);
  });

  afterAll(async () => {
    agentX?.close();
    agentY?.close();
    await handle?.close();
    for (const d of [rootIP, rootD, yIP, yD]) fs.rmSync(d, { recursive: true, force: true });
  });

  it('the full loop — genesis FF, edit FF, and a CLEAN WEAVE — is byte-identical', async () => {
    /* step A — GENESIS */
    const forkIP = forkNative(rootIP, 'agent-x');
    const forkD = await agentX.fork();
    expect(j(forkD)).toBe(j(forkIP));

    const pAIP = await proposeNative(rootIP, { worktree: rootIP, agentId: 'agent-x', actor: 'agent-x', intent: 'genesis', now: T[0] });
    const pAD = await agentX.propose({ intent: 'genesis', now: T[0] });
    expect(j(pAD)).toBe(j(pAIP)); // scratch strand: pickId/stateId/treeId/delta byte-equal

    const aAIP = await admitNative(rootIP, { worktree: rootIP, agentId: 'agent-x', actor: 'agent-x', now: T[1], noRestore: true });
    const aAD = await agentX.admit({ now: T[1], noRestore: true });
    expect(aAIP.decision.status).toBe('FAST_ADMIT');
    expect(j(aAD)).toBe(j(aAIP)); // ← acceptance (b), genesis

    /* agent-y forks at the genesis selvage, into its own worktree */
    const fyIP = forkNative(rootIP, 'agent-y', { into: yIP });
    const fyD = await agentY.fork({ into: yD });
    expect(j(fyD)).toBe(j(fyIP));

    /* step B — agent-x edits foo and admits (selvage advances) */
    for (const r of [rootIP, rootD]) write(r, MOD, BASE.replace('return 1', 'return 10'));
    const pBIP = await proposeNative(rootIP, { worktree: rootIP, agentId: 'agent-x', actor: 'agent-x', intent: 'x: foo → 10', now: T[2] });
    const pBD = await agentX.propose({ intent: 'x: foo → 10', now: T[2] });
    expect(j(pBD)).toBe(j(pBIP));

    const aBIP = await admitNative(rootIP, { worktree: rootIP, agentId: 'agent-x', actor: 'agent-x', now: T[3], noRestore: true });
    const aBD = await agentX.admit({ now: T[3], noRestore: true });
    expect(j(aBD)).toBe(j(aBIP)); // ← acceptance (b), fast-forward

    /* step C — agent-y edits the DISJOINT aux symbol from the genesis base:
     * meaning-disjoint vs x's foo edit → CLEAN WEAVE (the real merge path). */
    for (const w of [yIP, yD]) write(w, AUX, 'export function aux() { return 42; }\n');
    const pCIP = await proposeNative(rootIP, { worktree: yIP, agentId: 'agent-y', actor: 'agent-y', intent: 'y: aux → 42', now: T[4] });
    const pCD = await agentY.propose({ worktree: yD, intent: 'y: aux → 42', now: T[4] });
    expect(j(pCD)).toBe(j(pCIP));

    const aCIP = await admitNative(rootIP, { worktree: yIP, agentId: 'agent-y', actor: 'agent-y', now: T[5], noRestore: true });
    const aCD = await agentY.admit({ worktree: yD, now: T[5], noRestore: true });
    expect(aCIP.decision.status).toBe('CLEAN');
    expect(aCIP.sealed).toBe(true);
    expect(aCIP.strand?.merge).toBeTruthy(); // a real weave with a merge recipe
    expect(j(aCD)).toBe(j(aCIP)); // ← acceptance (b), THE WEAVE

    /* the two fabrics converged to identical ref states, and both authenticate */
    expect(j(Object.fromEntries(listRefs(warplineDirOf(rootD))))).toBe(
      j(Object.fromEntries(listRefs(warplineDirOf(rootIP)))),
    );
    expect(verifyFabric(rootIP).failures).toEqual([]);
    expect(verifyFabric(rootD).failures).toEqual([]);
  });
});

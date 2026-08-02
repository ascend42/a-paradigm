/**
 * native-sequencing-refusals.test — the PW-2 site table (mcp-skin-spec §4).
 *
 * What these tests defend: BEFORE PW-2, every out-of-order call on the native
 * path (the most common cold-agent mistakes) threw a prose Error that the
 * daemon/CLI catch-alls collapsed to ENGINE / retry-identical / empty next[] —
 * a machine hint instructing an INFINITE LOSING RETRY while the real recovery
 * lived only in prose. Each prerequisite boundary now throws a RefusedError
 * carrying a typed refusal:v1 with the correct retriability and a populated
 * recovery ladder — asserted here site by site, exactly as pinned in the spec.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative, resolveNative } from '../src/fabric/native.js';
import { admit } from '../src/fabric/admit.js';
import { WORKTREE_REF } from '../src/absorb.js';
import { RefusedError } from '../src/fabric/refusal.js';
import { writeScratchRef } from '../src/fabric/scratch.js';
import { warplineDirOf, writeSelvage } from '../src/fabric/fabric.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

async function refusedBy(p: Promise<unknown> | (() => unknown)): Promise<RefusedError> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (err) {
    expect(err).toBeInstanceOf(RefusedError);
    const e = err as RefusedError;
    expect(e.refusal.schemaVersion).toBe('refusal:v1');
    return e;
  }
  throw new Error('expected a RefusedError, got a resolution');
}

describe('PW-2 — sequencing mistakes refuse with typed ladders, never ENGINE dead-ends', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-seq-refusals-'));
    write(root, MOD, BASE);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('admit with nothing proposed → BAD_REQUEST / retry-corrected / ladder fork→propose', async () => {
    const e = await refusedBy(admitNative(root, { worktree: root, agentId: 'cold' }));
    expect(e.refusal.code).toBe('BAD_REQUEST');
    expect(e.refusal.retriable).toBe('retry-corrected');
    expect(e.refusal.next.map((n) => n.verb)).toEqual(['fork', 'propose']);
    expect(e.refusal.next[1]!.requires).toEqual(['intent', 'worktree']);
    for (const n of e.refusal.next) expect(n.principal).toBe('agent');
  });

  it('propose over a legacy stateId scratch → UNSUPPORTED / retry-corrected / ladder fork', async () => {
    writeScratchRef(root, 'legacy', 'state:v0:deadbeef');
    const e = await refusedBy(proposeNative(root, { worktree: root, agentId: 'legacy', intent: 'x' }));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.retriable).toBe('retry-corrected');
    expect(e.refusal.next).toEqual([{ verb: 'fork', params: {}, requires: [], principal: 'agent' }]);
  });

  it('C-9 — git-era admit over a NATIVE pickId scratch → UNSUPPORTED / retry-corrected / ladder admit --native', async () => {
    // The MIRROR of the case directly above, and the one PW-2's site table
    // missed. `warpline fork` (the first step the agent-facing descriptors
    // teach) leaves a pickId in scratch; the git-era admission path handed that
    // raw value to store.loadState, got null, and reported it through the
    // "base cannot be loaded — repair .warpline/" guard: an untyped Error that
    // every skin's catch-all collapsed to ENGINE / retry-identical / prose-only
    // recovery. scratch.ts's own contract says consumers dispatch on the
    // `pick:`/`state:` prefix and never silently coerce — so dispatch, and name
    // the call that actually works.
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
    forkNative(root, 'crossed');
    const e = await refusedBy(admit(root, { cwd: root, agentId: 'crossed', ref: WORKTREE_REF }));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.retriable).toBe('retry-corrected');
    expect(e.refusal.next).toEqual([
      { verb: 'admit', params: { native: 'true' }, requires: [], principal: 'agent' },
    ]);
    // The prose must not repeat the false diagnosis the old Error carried.
    expect(e.message).not.toMatch(/repair \.warpline/);
    expect(e.message).toContain('--native');
  });

  it('resolve with no selvage → NOT_FOUND / never (nothing to resolve against)', async () => {
    const e = await refusedBy(resolveNative(root, { worktree: root, agentId: 'cold', reason: 'x' }));
    expect(e.refusal.code).toBe('NOT_FOUND');
    expect(e.refusal.retriable).toBe('never');
    expect(e.refusal.next).toEqual([]);
  });

  it('resolve with no scratch strand → NOT_FOUND / retry-corrected / ladder propose', async () => {
    // Seal a selvage first (genesis propose+admit), then resolve as an agent
    // with no proposal of its own.
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
    const e = await refusedBy(resolveNative(root, { worktree: root, agentId: 'cold', reason: 'x' }));
    expect(e.refusal.code).toBe('NOT_FOUND');
    expect(e.refusal.retriable).toBe('retry-corrected');
    expect(e.refusal.next).toEqual([
      { verb: 'propose', params: {}, requires: ['intent', 'worktree'], principal: 'agent' },
    ]);
  });

  it('legacy fabric (stateId selvage, no pickId ref) → UNSUPPORTED / never / refs.migrate (human)', async () => {
    writeSelvage(warplineDirOf(root), 'state:v0:cafecafe'); // legacy pointer, no refs/heads/selvage
    const e = await refusedBy(() => forkNative(root, 'cold'));
    expect(e.refusal.code).toBe('UNSUPPORTED');
    expect(e.refusal.retriable).toBe('never');
    expect(e.refusal.next).toEqual([{ verb: 'refs.migrate', params: {}, requires: [], principal: 'human' }]);
  });

  it('disjoint DAG roots at admit → INTEGRITY_BROKEN / never / empty next[] (escalate)', async () => {
    // A proposes at genesis (parentless strand); B seals the genesis selvage.
    // A's history then shares NO base with the selvage — the record is suspect.
    await proposeNative(root, { worktree: root, agentId: 'A', intent: 'A at genesis' });
    const bDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-seq-b-'));
    try {
      write(bDir, MOD, 'export function foo() { return 2; }\n');
      await proposeNative(root, { worktree: bDir, agentId: 'B', intent: 'B at genesis' });
      await admitNative(root, { worktree: bDir, agentId: 'B', noRestore: true });
      const e = await refusedBy(admitNative(root, { worktree: root, agentId: 'A', noRestore: true }));
      expect(e.refusal.code).toBe('INTEGRITY_BROKEN');
      expect(e.refusal.retriable).toBe('never');
      expect(e.refusal.next).toEqual([]);
    } finally {
      fs.rmSync(bDir, { recursive: true, force: true });
    }
  });

  it('PW-10 — re-fork over a sealed, unadmitted proposal → BAD_REQUEST / retry-corrected / ladder admit', async () => {
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
    forkNative(root, 'W');
    write(root, MOD, 'export function foo() { return 7; }\n');
    await proposeNative(root, { worktree: root, agentId: 'W', intent: 'W edit' });
    const e = await refusedBy(() => forkNative(root, 'W'));
    expect(e.refusal.code).toBe('BAD_REQUEST');
    expect(e.refusal.retriable).toBe('retry-corrected');
    // C-10: `abandon` rides SECOND — admitting is still the goal, but the ladder
    // must offer an agent-runnable exit here, because the position where admit
    // NOOPs forever (a crash between the weave's ref advance and clearScratch)
    // is answered by this exact rule and used to point straight back at admit.
    expect(e.refusal.next).toEqual([
      { verb: 'admit', params: {}, requires: [], principal: 'agent' },
      { verb: 'abandon', params: {}, requires: [], principal: 'agent' },
    ]);
    // the prose named a verb that did not exist until C-10 ("resolve/abandon")
    expect(e.message).toContain('abandon');
    expect(e.message).not.toMatch(/resolve\/abandon/);
  });

  it('D-6b — re-fork over a CONTESTED proposal answers knot.show, NOT admit (aligned with status)', async () => {
    // The guard fires in two different positions and used to answer both with
    // `admit`. After a KNOT that is the exact identical-repeat the classifier
    // scores W1, while the status carrier answers the SAME position with
    // knot.show + "escalate rather than retry". The ladder is now derived from
    // NEXT_LEGAL_VERBS, so the two carriers cannot contradict each other.
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });

    const dirW = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-seq-w-'));
    const dirX = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-seq-x-'));
    try {
      forkNative(root, 'W', { into: dirW });
      forkNative(root, 'X', { into: dirX });

      // X advances the selvage; W contradicts it on the SAME symbol → KNOT.
      write(dirX, MOD, 'export function foo() { return 300; }\n');
      await proposeNative(root, { worktree: dirX, agentId: 'X', intent: 'X: foo 300' });
      const ax = await admitNative(root, { worktree: dirX, agentId: 'X', noRestore: true });
      expect(ax.sealed).toBe(true);

      write(dirW, MOD, 'export function foo() { return 400; }\n');
      await proposeNative(root, { worktree: dirW, agentId: 'W', intent: 'W: foo 400' });
      const knot = await admitNative(root, { worktree: dirW, agentId: 'W', noRestore: true });
      expect(knot.decision.status).toBe('KNOT');
      expect(knot.knotPayloadId).toBeDefined();

      // W re-forks instead of reading the work order — the clobber guard fires,
      // and the ladder must name the work order, not a losing re-admit.
      const e = await refusedBy(() => forkNative(root, 'W'));
      expect(e.refusal.code).toBe('BAD_REQUEST');
      expect(e.refusal.next).toEqual([
        { verb: 'knot.show', params: { selector: knot.knotPayloadId }, requires: [], principal: 'agent' },
        // C-10: and the withdrawal door, SECOND — the work order stays the first
        // instruction, but "escalate rather than retry" was previously the whole
        // ladder, which left an all-agent swarm with no legal move at all.
        { verb: 'abandon', params: {}, requires: [], principal: 'agent' },
      ]);
      // the human sentence follows the same carrier — no third instruction
      expect(e.message).toContain('CONTESTED');
      expect(e.message).not.toMatch(/Admit it first/);
    } finally {
      fs.rmSync(dirW, { recursive: true, force: true });
      fs.rmSync(dirX, { recursive: true, force: true });
    }
  }, 60_000);

  it('re-fork at the SAME selvage tip stays legal (idempotent fork is not a clobber)', async () => {
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
    const f1 = forkNative(root, 'W');
    const f2 = forkNative(root, 'W'); // no proposal sealed in between — no orphan risk
    expect(f2.base).toBe(f1.base);
  });
});

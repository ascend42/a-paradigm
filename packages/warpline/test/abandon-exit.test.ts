/**
 * abandon-exit.test — the agent-class EXIT (soundness audit 2026-07-31, C-10;
 * Arky D-D, reproduced organically during a stress run).
 *
 * THE WEDGE. After a KNOT — or after a crash between the weave's ref advance
 * and `clearScratch` (native.ts) — every agent-class door was shut:
 *   `admit`  returns NOOP without clearing the scratch,
 *   `fork`   refuses with the clobber guard and points back at `admit`,
 *   `resolve` clears the scratch but is HUMAN_ONLY.
 * A closed cycle. The clobber guard's own prose even named `abandon` as the way
 * out and no such verb existed anywhere in the codebase. `git merge --abort` is
 * always available and never human-only; an all-agent swarm halted on its first
 * genuine conflict, which is the exact scenario the product exists to serve.
 *
 * The two design choices this file pins, because both are load-bearing:
 *   1. SEALED WORK IS NEVER LOST. Only the scratch pointer is cleared. The
 *      strand stays in the ledger, `fabric verify` reports it as an abandoned
 *      head exactly as it did before (that report reads refs/heads, which a
 *      scratch ref was never in), and it is restorable by pickId forever.
 *   2. AN OPEN KNOT STAYS OPEN. The payload is untouched, the selvage does not
 *      move, no weave is sealed and no resolution envelope is written.
 *      Abandoning CONCEDES a contest; a human still owns resolving it. The
 *      still-open payload ids come back in the result so it is not silent.
 *
 * NEVER against the live fabric — scratch fixtures only (isolation law).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { forkNative, proposeNative, admitNative, abandonNative } from '../src/fabric/native.js';
import { readScratch } from '../src/fabric/scratch.js';
import { readRef } from '../src/fabric/refs.js';
import { readFabric, warplineDirOf } from '../src/fabric/fabric.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { listKnotPayloads } from '../src/fabric/knot-payload.js';
import { restore } from '../src/fabric/restore.js';
import { RefusedError } from '../src/fabric/refusal.js';

const MOD = 'src/mod.ts';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('#native-write-path — `abandon`, the agent-class exit (C-10)', () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-abandon-'));
    write(root, MOD, 'export function foo() { return 1; }\n');
    await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    await admitNative(root, { worktree: root, agentId: 'genesis', noRestore: true });
  }, 120_000);

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('clears the scratch pointer and NOTHING else — the sealed strand survives', async () => {
    forkNative(root, 'W');
    write(root, MOD, 'export function foo() { return 7; }\n');
    const proposal = await proposeNative(root, { worktree: root, agentId: 'W', intent: 'W edit' });
    const pick = proposal.strand!.pickId;
    const selvageBefore = readRef(warplineDirOf(root), 'selvage');
    const strandsBefore = readFabric(warplineDirOf(root)).length;

    const out = await abandonNative(root, 'W');
    expect(out.abandoned).toBe(true);
    expect(out.abandonedPick).toBe(pick);
    expect(out.sealedProposal).toBe(true);

    // the pointer is gone …
    expect(readScratch(root, 'W')).toBeNull();
    // … and NOTHING else moved: same ledger length, same selvage tip.
    expect(readFabric(warplineDirOf(root)).length).toBe(strandsBefore);
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(selvageBefore);
    // the strand is still IN the ledger, byte for byte.
    expect(readFabric(warplineDirOf(root)).some((s) => s.pickId === pick)).toBe(true);
  }, 120_000);

  it('CHOICE 1 — the abandoned head stays legal in verify and restorable by pickId', async () => {
    forkNative(root, 'W');
    write(root, MOD, 'export function foo() { return 7; }\n');
    const proposal = await proposeNative(root, { worktree: root, agentId: 'W', intent: 'W edit' });
    const pick = proposal.strand!.pickId;

    const before = verifyFabric(root);
    await abandonNative(root, 'W');
    const after = verifyFabric(root);

    // `abandonedHeads` is computed from DAG heads no refs/heads entry names, and
    // listRefs reads refs/heads ONLY — a scratch ref never suppressed the
    // report, so withdrawing one cannot change it. Same report, still intact.
    expect(after.failures).toEqual([]);
    expect(after.abandonedHeads).toEqual(before.abandonedHeads);
    expect(after.abandonedHeads).toContain(pick);

    // and the withdrawn work is still materializable, with nothing but its id.
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-abandon-restore-'));
    try {
      const r = restore(root, { selector: pick, to: dest });
      expect(r.pickId).toBe(pick);
      expect(r.entriesRestored).toBeGreaterThan(0);
      expect(fs.readFileSync(path.join(dest, MOD), 'utf8')).toBe('export function foo() { return 7; }\n');
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }, 120_000);

  it('CHOICE 2 — abandoning a CONTESTED proposal leaves the KNOT open and the other side untouched', async () => {
    const dirW = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-abandon-w-'));
    const dirX = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-abandon-x-'));
    try {
      forkNative(root, 'W', { into: dirW });
      forkNative(root, 'X', { into: dirX });

      // X advances the selvage; W contradicts it on the same symbol → KNOT.
      write(dirX, MOD, 'export function foo() { return 300; }\n');
      await proposeNative(root, { worktree: dirX, agentId: 'X', intent: 'X: foo 300' });
      expect((await admitNative(root, { worktree: dirX, agentId: 'X', noRestore: true })).sealed).toBe(true);

      write(dirW, MOD, 'export function foo() { return 400; }\n');
      await proposeNative(root, { worktree: dirW, agentId: 'W', intent: 'W: foo 400' });
      const knot = await admitNative(root, { worktree: dirW, agentId: 'W', noRestore: true });
      expect(knot.decision.status).toBe('KNOT');
      const payloadId = knot.knotPayloadId!;
      expect(payloadId).toBeDefined();

      const selvageAtKnot = readRef(warplineDirOf(root), 'selvage');
      const payloadsBefore = listKnotPayloads(root).map((p) => p.payloadId).sort();

      const out = await abandonNative(root, 'W');

      // the withdrawal is LEGIBLE: the still-open work order is named back.
      expect(out.openKnotPayloadIds).toContain(payloadId);
      // the KNOT is not resolved, not deleted, not marked — byte-identical set.
      expect(listKnotPayloads(root).map((p) => p.payloadId).sort()).toEqual(payloadsBefore);
      // the OTHER side is untouched: the selvage still names X's admission.
      expect(readRef(warplineDirOf(root), 'selvage')).toBe(selvageAtKnot);
      // no weave, no resolution envelope — abandoning is a concession, not a seal.
      expect(readFabric(warplineDirOf(root)).some((s) => s.resolves)).toBe(false);
      // X's scratch is its own business.
      expect(readScratch(root, 'X')).toBeNull();
    } finally {
      fs.rmSync(dirW, { recursive: true, force: true });
      fs.rmSync(dirX, { recursive: true, force: true });
    }
  }, 180_000);

  it('breaks the closed cycle: after abandoning, fork is legal again', async () => {
    forkNative(root, 'W');
    write(root, MOD, 'export function foo() { return 7; }\n');
    await proposeNative(root, { worktree: root, agentId: 'W', intent: 'W edit' });

    // the wedge itself: re-forking over a sealed, unadmitted proposal refuses…
    let refused: RefusedError | null = null;
    try {
      forkNative(root, 'W');
    } catch (err) {
      refused = err as RefusedError;
    }
    expect(refused, 'fork must refuse over a sealed proposal (the clobber guard)').toBeInstanceOf(RefusedError);
    // …and the ladder it hands back now names a verb that EXISTS and is the
    // agent's own to run — the whole of C-10 in one assertion.
    const exit = refused!.refusal.next.find((n) => n.verb === 'abandon');
    expect(exit, 'the clobber ladder must offer the withdrawal door').toBeDefined();
    expect(exit!.principal).toBe('agent');
    expect(exit!.requires).toEqual([]);

    // follow it verbatim, and the cycle opens.
    await abandonNative(root, 'W');
    expect(() => forkNative(root, 'W')).not.toThrow();
  }, 120_000);

  it('the CRASH wedge: a scratch already merged into the selvage escapes via abandon', async () => {
    // Reproduce what a crash between native.ts's ref advance and clearScratch
    // leaves behind. It has to be a WEAVE (not a fast-forward) for the wedge to
    // bite: the selvage then names the weave while the scratch still names the
    // proposal, which is now selvage ANCESTRY — so admit answers NOOP forever
    // while fork refuses, because scratch ≠ selvage tip. Two writers, one
    // non-conflicting merge, is the smallest way to get there.
    const dirW = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-crash-w-'));
    const dirX = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-crash-x-'));
    try {
      forkNative(root, 'W', { into: dirW });
      forkNative(root, 'X', { into: dirX });

      write(dirX, 'src/other.ts', 'export function bar() { return 2; }\n');
      await proposeNative(root, { worktree: dirX, agentId: 'X', intent: 'X: add bar' });
      expect((await admitNative(root, { worktree: dirX, agentId: 'X', noRestore: true })).sealed).toBe(true);

      write(dirW, MOD, 'export function foo() { return 7; }\n');
      const proposal = await proposeNative(root, { worktree: dirW, agentId: 'W', intent: 'W: foo 7' });
      const woven = await admitNative(root, { worktree: dirW, agentId: 'W', noRestore: true });
      expect(woven.sealed).toBe(true);
      expect(woven.decision.status).toBe('CLEAN');

      // THE CRASH: the scratch pointer survives the seal that should have cleared it.
      fs.writeFileSync(path.join(warplineDirOf(root), 'refs', 'scratch', 'W'), proposal.strand!.pickId + '\n', 'utf8');

      // Door 1: admit — NOOP, and it does NOT clear the scratch.
      const noop = await admitNative(root, { worktree: dirW, agentId: 'W', noRestore: true });
      expect(noop.decision.status).toBe('NOOP');
      expect(noop.sealed).toBe(false);
      expect(readScratch(root, 'W'), 'admit NOOP leaves the scratch exactly where it was').toBe(
        proposal.strand!.pickId,
      );
      // Door 2: fork — refuses, and (before C-10) sent the agent back to door 1.
      expect(() => forkNative(root, 'W')).toThrow(RefusedError);

      // The exit works here too, and loses nothing: the work is already admitted.
      const out = await abandonNative(root, 'W');
      expect(out.abandoned).toBe(true);
      expect(verifyFabric(root).failures).toEqual([]);
      expect(() => forkNative(root, 'W')).not.toThrow();
    } finally {
      fs.rmSync(dirW, { recursive: true, force: true });
      fs.rmSync(dirX, { recursive: true, force: true });
    }
  }, 180_000);

  it('is IDEMPOTENT — abandoning nothing is a no-op, never a refusal', async () => {
    const first = await abandonNative(root, 'never-forked');
    expect(first.abandoned).toBe(false);
    expect(first.abandonedPick).toBeNull();
    expect(first.openKnotPayloadIds).toEqual([]);

    forkNative(root, 'W');
    await abandonNative(root, 'W');
    const second = await abandonNative(root, 'W');
    expect(second.abandoned).toBe(false);
  }, 120_000);

  it('CROSS-PRINCIPAL SAFETY — abandoning one agent never touches another\'s scratch', async () => {
    forkNative(root, 'W');
    write(root, MOD, 'export function foo() { return 7; }\n');
    const wProposal = await proposeNative(root, { worktree: root, agentId: 'W', intent: 'W edit' });
    forkNative(root, 'X');
    const xScratch = readScratch(root, 'X');
    expect(xScratch).not.toBeNull();

    const out = await abandonNative(root, 'W');
    expect(out.agentId).toBe('W');
    expect(out.abandonedPick).toBe(wProposal.strand!.pickId);
    // X is untouched — the exit is scoped to the principal that runs it. On the
    // daemon this is structural (no target param, the principal is server-
    // stamped); here it is the engine honouring the same scope.
    expect(readScratch(root, 'X')).toBe(xScratch);
    expect(readScratch(root, 'W')).toBeNull();

    // and the reverse direction: withdrawing X leaves nothing of W's to lose.
    await abandonNative(root, 'X');
    expect(readScratch(root, 'X')).toBeNull();
    expect(readFabric(warplineDirOf(root)).some((s) => s.pickId === wProposal.strand!.pickId)).toBe(true);
  }, 120_000);

  it('withdrawing an UNPROPOSED fork reports it as no sealed proposal', async () => {
    forkNative(root, 'W');
    const out = await abandonNative(root, 'W');
    expect(out.abandoned).toBe(true);
    // the scratch held the fork BASE (a pickId someone else authored), not a
    // proposal of this agent's — the report must not claim otherwise.
    expect(out.sealedProposal).toBe(false);
    expect(out.openKnotPayloadIds).toEqual([]);
  }, 120_000);
});

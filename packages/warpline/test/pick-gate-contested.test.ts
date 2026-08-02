/**
 * pick-gate-contested.test — C-9: the R2 pick gate PRODUCING a contested
 * verdict, and the record saying when it could not have.
 *
 * The soundness audit (2026-07-31, C-9 / Jinx J-4) recorded that KNOT, CLEAN,
 * HELD and DANGLE "cannot occur on this path at all", on the reasoning that
 * `pick.ts` contains zero scratch references, so `admit.ts`'s base falls back to
 * the selvage and `admitDecision` short-circuits to FAST_ADMIT. The first half
 * is true and the conclusion is not: #pick has no fork step BY DESIGN (it is the
 * single-writer git-coexistence door; the multi-writer cycle is fork → propose →
 * admit), but the base it judges against is minted by a DIFFERENT verb —
 * `warpline scratch <agentId>` / `forkScratch`. With one, the gate produces
 * genuine contested verdicts; without one, FAST_ADMIT is forced structurally.
 *
 * So the empty denominator on this path is BEHAVIOURAL — nobody runs the base
 * verb before an attributed pick — not mechanical. These tests pin both halves:
 *
 *   1. THE EXIT CRITERION — a real KNOT on the gated path, two agent-attributed
 *      writers genuinely contending, driven by the #f4-seed engine functions
 *      (seedWorld / rivalAdvance) rather than a hand-rolled rival. Git absent.
 *   2. `baseFrom` — the SAME proposal, judged twice, once with a base and once
 *      without: two different verdicts, and the row now names the reason. Before
 *      this field a FAST_ADMIT that had no base was indistinguishable on the
 *      telemetry stream from a FAST_ADMIT that had one and found no contest.
 *   3. THE NO-LAUNDERING RULE — a typed prerequisite refusal raised inside the
 *      pipeline survives the gate's fail-closed catch with its code, its
 *      retriability and its ladder intact; a genuinely untyped failure still
 *      becomes ENGINE / retry-identical, which is correct for a transient.
 *
 * ISOLATION: every fabric here is an os.tmpdir() scratch world. Nothing resolves
 * a repo root implicitly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { seedWorld, rivalAdvance } from '../src/f4/seed.js';
import { recordPick, PickGateRefusal } from '../src/fabric/pick.js';
import { forkScratch, writeScratchRef, readScratch } from '../src/fabric/scratch.js';
import { readShadowVerdicts } from '../src/fabric/shadow.js';
import { configPathOf } from '../src/fabric/config.js';
import { warplineDirOf, readFabric, readSelvage } from '../src/fabric/fabric.js';

const CONTESTED = 'src/contested.ts';
/** The subject's competing body for the symbol the seed's rival also rewrites. */
const SUBJECT_BODY = 'export function pivot() { return 7; }\nexport function caller() { return pivot() + 1; }\n';

/** A scratch world with the R2 gate ENFORCED for attributed writes. */
function newWorld(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, '.warpline'), { recursive: true });
  fs.writeFileSync(configPathOf(root), JSON.stringify({ gate: { agentWrites: 'real' } }), 'utf8');
  return root;
}

async function refusedPick(root: string, agentId: string, intent: string): Promise<PickGateRefusal> {
  try {
    await recordPick(root, { cwd: root, agentId, intent });
  } catch (err) {
    expect(err).toBeInstanceOf(PickGateRefusal);
    return err as PickGateRefusal;
  }
  throw new Error('expected a PickGateRefusal, got a seal');
}

describe('C-9 — the R2 pick gate produces a genuine contested verdict', () => {
  let root: string;

  beforeEach(() => {
    root = newWorld('warpline-c9-knot-');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('two agent-attributed writers contending → KNOT on the gated pick path (nothing sealed)', async () => {
    // A sealed genesis selvage, via the real engine functions (#f4-seed).
    const { file } = await seedWorld({ root });
    expect(file).toBe(CONTESTED);

    // The SUBJECT pins its base. This — not #pick — is the pick path's fork.
    forkScratch(root, 'subject');
    const base = readScratch(root, 'subject');
    expect(base).toBe(readSelvage(warplineDirOf(root)));

    // The subject edits the contested symbol in its own worktree…
    fs.writeFileSync(path.join(root, CONTESTED), SUBJECT_BODY, 'utf8');
    // …and the SCRIPTED RIVAL advances the selvage underneath it, in an isolated
    // worktree, through the same fork → propose → admit engine the daemon drives.
    const rival = await rivalAdvance({ root });
    expect(rival.sealed).toBe(true);
    const movedSelvage = readSelvage(warplineDirOf(root));
    expect(movedSelvage).not.toBe(base); // the selvage genuinely moved past the base

    const strandsBefore = readFabric(warplineDirOf(root)).length;
    const e = await refusedPick(root, 'subject', 'subject contests the pivot');

    // THE VERDICT — a real KNOT, not a gate default.
    expect(e.refusal!.verdict).toBe('KNOT');
    expect(e.refusal!.code).toBe('GATE_REFUSED');
    expect(e.refusal!.gate).toBe('pick');
    expect(e.refusal!.retriable).toBe('retry-after-resolve');
    // …over the symbol both principals rewrote, with the rule that fired.
    const direct = e.refusal!.contested.filter((c) => c.rank === 'direct');
    expect(direct.map((c) => c.symbol)).toEqual([`#code:${CONTESTED}::pivot`]);
    expect(direct[0]!.rule).toBe('conflicting-slot');
    expect(direct[0]!.conflictingSlots).toEqual(['body']);
    expect(e.refusal!.pointers.rebasedOnto).toBe(movedSelvage);

    // THE HOLD — the seal did not happen, on either pointer.
    expect(readFabric(warplineDirOf(root)).length).toBe(strandsBefore);
    expect(readSelvage(warplineDirOf(root))).toBe(movedSelvage);
    expect(readScratch(root, 'subject')).toBe(base); // the work is kept

    // THE RECORD — the enforced verdict is durable telemetry.
    const row = readShadowVerdicts(root).at(-1)!;
    expect(row.agentId).toBe('subject');
    expect(row.status).toBe('KNOT');
    expect(row.gate).toBe('real');
    expect(row.wouldSeal).toBe(false);
    expect(row.overridden).toBeUndefined();
    expect(row.knots).toContain(`#code:${CONTESTED}::pivot`);
    // The two sides are ATTRIBUTED to two different principals: the rival's
    // advance is authored by seed-rival, the refused proposal by subject.
    // Located by attribution, never by ledger position (G2).
    const authors = readFabric(warplineDirOf(root)).map((s) => s.authoredBy?.agentId);
    expect(authors).toContain(rival.rivalId);
    expect(rival.rivalId).not.toBe('subject');
    expect(row.baseFrom).toBe('scratch'); // the verdict was a real re-base judgment
  });

  it('baseFrom: the SAME proposal is KNOT with a base and FAST_ADMIT without one', async () => {
    await seedWorld({ root });
    forkScratch(root, 'with-base'); // pinned BEFORE the selvage moves
    fs.writeFileSync(path.join(root, CONTESTED), SUBJECT_BODY, 'utf8');
    await rivalAdvance({ root });

    // Arm 1 — a base exists: a real re-base judgment.
    const e = await refusedPick(root, 'with-base', 'with a pinned base');
    const withBase = readShadowVerdicts(root).at(-1)!;
    expect(e.refusal!.verdict).toBe('KNOT');
    expect(withBase.status).toBe('KNOT');
    expect(withBase.baseFrom).toBe('scratch');

    // Arm 2 — SAME bytes, SAME selvage, SAME ref; only the base is absent.
    expect(readScratch(root, 'no-base')).toBeNull();
    const sealed = await recordPick(root, { cwd: root, agentId: 'no-base', intent: 'no pinned base' });
    const noBase = readShadowVerdicts(root).at(-1)!;
    expect(sealed.noop).toBe(false);
    expect(noBase.status).toBe('FAST_ADMIT');
    expect(noBase.baseFrom).toBe('selvage');

    // THE BINDING. Identical proposal on both arms (same absorbed state, same
    // ref) — so the verdict difference is attributable to the BASE alone, and
    // `baseFrom` is the field that names it. Without this the 27 FAST_ADMITs on
    // the live stream read as "no contention" when they mean "no base".
    expect(noBase.proposedStateId).toBe(withBase.proposedStateId);
    expect(noBase.ref).toBe(withBase.ref);
    expect(noBase.status).not.toBe(withBase.status);
    expect(noBase.baseFrom).not.toBe(withBase.baseFrom);
  });
});

describe('C-9 — the pick gate never launders a typed pipeline refusal', () => {
  let root: string;

  beforeEach(() => {
    root = newWorld('warpline-c9-launder-');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a NATIVE pickId scratch → UNSUPPORTED / retry-corrected / ladder `admit --native`', async () => {
    await seedWorld({ root });
    // Exactly what `warpline fork` leaves behind — and `fork` is the FIRST step
    // the agent-facing descriptors teach, so this is the position a cold agent
    // reaches before it has done anything wrong.
    const tip = readFabric(warplineDirOf(root)).at(-1)!;
    writeScratchRef(root, 'cold', tip.pickId);
    fs.writeFileSync(path.join(root, CONTESTED), SUBJECT_BODY, 'utf8');

    const e = await refusedPick(root, 'cold', 'cold agent picks after fork');
    // The typed refusal SURVIVES the gate's fail-closed catch…
    expect(e.refusal!.code).toBe('UNSUPPORTED');
    expect(e.refusal!.retriable).toBe('retry-corrected');
    expect(e.refusal!.next).toEqual([
      { verb: 'admit', params: { native: 'true' }, requires: [], principal: 'agent' },
    ]);
    // …re-homed to the gate that raised it, and NOT rewritten as the ENGINE
    // dead-end whose ladder ("retry the identical `pick`") fails forever.
    expect(e.refusal!.gate).toBe('pick');
    expect(e.refusal!.code).not.toBe('ENGINE');
    expect(e.refusal!.retriable).not.toBe('retry-identical');
    expect(e.refusal!.next.map((n) => n.verb)).not.toContain('pick');
    // Nothing sealed, and the agent's proposal pointer is untouched.
    expect(readScratch(root, 'cold')).toBe(tip.pickId);
  });

  it('CONTROL — an UNTYPED pipeline failure is still ENGINE / retry-identical (a transient may retry)', async () => {
    await seedWorld({ root });
    // A stateId scratch naming a state the store cannot load: the git-era admit
    // throws a plain Error here (corruption/regen-gap), which is exactly the
    // fail-closed case the ENGINE default was written for — the request was
    // well-formed and the identical call may succeed once the cache is repaired.
    writeScratchRef(root, 'broken', 'state:v0:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    fs.writeFileSync(path.join(root, CONTESTED), SUBJECT_BODY, 'utf8');

    const e = await refusedPick(root, 'broken', 'unloadable base');
    expect(e.refusal!.code).toBe('ENGINE');
    expect(e.refusal!.retriable).toBe('retry-identical');
    expect(e.refusal!.next.map((n) => n.verb)).toEqual(['pick']);
  });
});

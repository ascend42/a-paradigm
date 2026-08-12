/**
 * grade.test — the calibration grader (the moat). A strand whose authored symbols
 * a later strand RETIRES/contends is overturned (confidence ↓); one whose symbols
 * hold across the window is survived (↑); too-recent is pending. Buckets by the
 * gate-rule prior class so the linked-vs-independent survival question is data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { warplineDirOf, appendStrand, readFabric } from '../src/fabric/fabric.js';
import {
  gradeFabric,
  applyGrades,
  readGradeSidecar,
  symbolSurvivalIndex,
  evaluateEscalation,
  K_MIN_GRADED,
  SURVIVAL_FLOOR,
  type GradeSidecarRow,
} from '../src/fabric/grade.js';
import { computePickId, type Strand, type StrandBody } from '../src/fabric/strand.js';

/**
 * Build a REAL, DAG-linked v2 strand. Grading is now REACHABILITY-scoped
 * (TD-2026-08-12-813), so a fixture must express genuine ancestry via parentPickId
 * — an unlinked strand (a v1 self-hash, or a v2 with a dangling parent) has NO
 * resolvable descendants and would grade PENDING regardless of arrival order. The
 * v2 pickId excludes calibratedConfidence (like v1), so applyGrades still moves the
 * confidence byte without disturbing the content-address. Pass the PARENT strand
 * (null at genesis) to place this strand on a line of history; two children of the
 * same parent are CONCURRENT branches.
 */
function v2(
  seq: number,
  parent: Strand | null,
  over: { born?: string[]; retired?: string[]; changed?: string[]; conf?: number | null; agentId?: string } = {},
): Strand {
  const { born = [], retired = [], changed = [], conf = null, agentId } = over;
  const body: StrandBody = {
    schemaVersion: 2,
    seq,
    parentPickId: parent ? parent.pickId : null,
    parentStateId: parent ? parent.stateId : null,
    ...(agentId ? { authoredBy: { agentId } } : {}),
    stateId: `state:v0:seq${seq}`,
    actor: 'tester',
    intent: `seq ${seq}`,
    recordedAt: '2026-06-27T00:00:00.000Z',
    objectCount: 10,
    delta: { born, retired, contractChanged: changed, renamedNoop: 0 },
    calibratedConfidence: conf,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
  };
  return { ...body, pickId: computePickId(body) };
}

describe('gradeFabric · survive / overturn / pending', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-grade-'));
    const wdir = warplineDirOf(root);
    // A LINEAR v2 chain (each strand's parent = the previous strand), so DAG
    // reachability == ledger order here — the linear-chain behavior is preserved
    // EXACTLY. 0 genesis; 1 pick(#a,#b); 2 pick(#c) retires #a; 3 LINKED admit(#x);
    // 4 INDEPENDENT admit(#y) retires #x; 5 pick(#z); 6 pick(#w).
    const s0 = v2(0, null);
    const s1 = v2(1, s0, { born: ['#a', '#b'] });
    const s2 = v2(2, s1, { born: ['#c'], retired: ['#a'] });
    const s3 = v2(3, s2, { born: ['#x'], conf: 0.9, agentId: 'agent-a' });
    const s4 = v2(4, s3, { born: ['#y'], retired: ['#x'], conf: 0.6, agentId: 'agent-b' });
    const s5 = v2(5, s4, { born: ['#z'] });
    const s6 = v2(6, s5, { born: ['#w'] });
    for (const s of [s0, s1, s2, s3, s4, s5, s6]) appendStrand(wdir, s);
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('classifies outcomes and moves confidence correctly', () => {
    const r = gradeFabric(root, { window: 2 });
    const by = new Map(r.grades.map((g) => [g.seq, g]));

    expect(by.get(0)!.outcome).toBe('baseline');

    // seq1: #a retired by seq2 → overturned (1 of 2 authored)
    expect(by.get(1)!.outcome).toBe('overturned');
    expect(by.get(1)!.overturnedSymbols).toEqual(['#a']);
    expect(by.get(1)!.confidenceAfter).toBe(0.52); // 0.7 * (1 - 0.5*0.5), float-rounded

    // seq2: #c held across 4 later strands → survived
    expect(by.get(2)!.outcome).toBe('survived');
    expect(by.get(2)!.confidenceAfter).toBe(0.8); // 0.7 + 0.1

    // seq3: a LINKED admit (0.9) whose #x is retired by seq4 → overturned
    expect(by.get(3)!.outcome).toBe('overturned');
    expect(by.get(3)!.priorClass).toBe('linked');
    expect(by.get(3)!.confidenceAfter).toBe(0.45); // 0.9 * 0.5

    // seq4: an INDEPENDENT admit (0.6) whose #y holds → survived
    expect(by.get(4)!.outcome).toBe('survived');
    expect(by.get(4)!.priorClass).toBe('independent');
    expect(by.get(4)!.confidenceAfter).toBe(0.7); // 0.6 + 0.1

    // seq5: only 1 later strand (< window 2) → pending
    expect(by.get(5)!.outcome).toBe('pending');
    expect(by.get(6)!.outcome).toBe('pending');
  });

  it('buckets outcomes by prior class (the moat signal)', () => {
    const r = gradeFabric(root, { window: 2 });
    expect(r.moat.linked.overturned).toBe(1);
    expect(r.moat.independent.survived).toBe(1);
    expect(r.moat.pick.survived).toBe(1); // seq2
    expect(r.moat.pick.overturned).toBe(1); // seq1
    expect(r.moat.pick.pending).toBe(2); // seq5, seq6
  });

  it('applyGrades writes calibratedConfidence into the ledger + a trajectory event', async () => {
    const r = gradeFabric(root, { window: 2 });
    await applyGrades(root, r, '2026-06-27T01:00:00.000Z');
    const fabric = readFabric(warplineDirOf(root));
    const seq2 = fabric.find((s) => s.seq === 2)!;
    expect(seq2.calibratedConfidence).toBe(0.8); // mutated in place
    // grades.jsonl trajectory written (non-baseline only)
    const grades = fs.readFileSync(path.join(warplineDirOf(root), 'grades.jsonl'), 'utf8').trim().split('\n');
    expect(grades.length).toBe(6); // seq 1-6, genesis excluded
  });

  // ── P3 Lane A2 — the keyed dimensions (agentId × symbol) ─────────────────────

  it('buckets outcomes by authoredBy.agentId (unattributed strands skipped)', () => {
    const r = gradeFabric(root, { window: 2 });
    expect(r.byAgent['agent-a']).toEqual({ survived: 0, overturned: 1, pending: 0 }); // seq3 (#x retired)
    expect(r.byAgent['agent-b']).toEqual({ survived: 1, overturned: 0, pending: 0 }); // seq4 (#y held)
    expect(Object.keys(r.byAgent).sort()).toEqual(['agent-a', 'agent-b']); // seq1/2/5/6 carry no agentId
  });

  it('buckets outcomes by authored SYMBOL with the per-symbol rule', () => {
    const r = gradeFabric(root, { window: 2 });
    expect(r.bySymbol['#a']).toEqual({ survived: 0, overturned: 1, pending: 0 }); // retired by seq2
    expect(r.bySymbol['#x']).toEqual({ survived: 0, overturned: 1, pending: 0 }); // retired by seq4
    expect(r.bySymbol['#c']).toEqual({ survived: 1, overturned: 0, pending: 0 });
    expect(r.bySymbol['#y']).toEqual({ survived: 1, overturned: 0, pending: 0 });
    expect(r.bySymbol['#z']).toEqual({ survived: 0, overturned: 0, pending: 1 });
    // #b rode an OVERTURNED strand without itself being overturned — survival
    // window unknown ⇒ NOT graded (never silently counted as survived).
    expect(r.bySymbol['#b']).toBeUndefined();
  });

  it('sidecar rows carry the keys; symbolSurvivalIndex dedups the trajectory (latest per pickId)', async () => {
    const r = gradeFabric(root, { window: 2 });
    await applyGrades(root, r, '2026-06-27T01:00:00.000Z');
    await applyGrades(root, gradeFabric(root, { window: 2 }), '2026-06-27T02:00:00.000Z'); // second run appends
    const rows = readGradeSidecar(root);
    expect(rows.length).toBe(12); // 6 non-baseline grades × 2 runs
    expect(rows[0].agentId).toBeDefined();
    expect(rows.find((x) => x.authoredSymbols?.includes('#y'))?.agentId).toBe('agent-b');
    const index = symbolSurvivalIndex(rows);
    // deduped: each pick graded ONCE despite two runs
    expect(index.get('#y')).toEqual({ survived: 1, overturned: 0, graded: 1, survival: 1 });
    expect(index.get('#x')).toEqual({ survived: 0, overturned: 1, graded: 1, survival: 0 });
    expect(index.get('#z')).toBeUndefined(); // pending — not a graded outcome
  });
});

// ── M2.5 branch-safety — survival/overturn is DAG-REACHABILITY-scoped, not ledger
// order (TD-2026-08-12-813). A concurrent branch's retire is NOT an overturn; an
// abandoned branch contributes nothing; and neither manufactures a false HELD.
describe('gradeFabric · reachability-scoped (M2.5 branches)', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-grade-dag-'));
    wdir = warplineDirOf(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('(b) a symbol RETIRED on a concurrent (non-descendant) branch does NOT overturn it', () => {
    // g0 ← main1(#a) ← main2 ← main3   [integration line]
    //  └──── branch(retire #a)          [CONCURRENT: forks g0, never builds on main1]
    const g0 = v2(0, null);
    const main1 = v2(1, g0, { born: ['#a'], conf: 0.6, agentId: 'agent-main' });
    const main2 = v2(2, main1);
    const main3 = v2(3, main2);
    const branch = v2(4, g0, { retired: ['#a'] }); // sibling of main1, not a descendant
    for (const s of [g0, main1, main2, main3, branch]) appendStrand(wdir, s);

    const by = new Map(gradeFabric(root, { window: 2 }).grades.map((g) => [g.seq, g]));
    // #a held across its OWN 2 descendants (main2, main3); the concurrent retire is
    // NOT in main1's descendant set, so it is NOT an overturn. (Under the old
    // ledger-linear slice(i+1), `branch` sat later in the file and marked #a overturned.)
    expect(by.get(1)!.outcome).toBe('survived');
    expect(by.get(1)!.overturnedSymbols).toEqual([]);
  });

  it('(c) an abandoned-branch strand contributes nothing to the integration line bySymbol survival', () => {
    // g0 ← m1(#a) ← m2 ← m3            [integration line — #a survives]
    //  └──── dead(#dead, retire #a)     [ABANDONED: never merged → no descendants]
    const g0 = v2(0, null);
    const m1 = v2(1, g0, { born: ['#a'] });
    const m2 = v2(2, m1);
    const m3 = v2(3, m2);
    const dead = v2(4, g0, { born: ['#dead'], retired: ['#a'] });
    for (const s of [g0, m1, m2, m3, dead]) appendStrand(wdir, s);

    const r = gradeFabric(root, { window: 2 });
    // #a survives on the integration line — the abandoned retire is not a descendant.
    expect(r.bySymbol['#a']).toEqual({ survived: 1, overturned: 0, pending: 0 });
    // #dead was authored ONLY on the abandoned tip (zero descendants) → PENDING →
    // it contributes NOTHING to survival/overturn. Falls out of reachability with no
    // dead-branch check.
    expect(r.bySymbol['#dead']?.survived ?? 0).toBe(0);
    expect(r.bySymbol['#dead']?.overturned ?? 0).toBe(0);
  });

  it('(d) evaluateEscalation does NOT fire when a symbol’s only "overturn" was a concurrent branch', async () => {
    // g0 ← p1(#s) ← p2(#s) ← p3(#s) ← p4 ← p5   [#s survives 3× on the line]
    //  └──── branch(retire #s)                    [CONCURRENT fork of g0]
    const g0 = v2(0, null);
    const p1 = v2(1, g0, { born: ['#s'], conf: 0.6, agentId: 'agent-a' });
    const p2 = v2(2, p1, { changed: ['#s'] });
    const p3 = v2(3, p2, { changed: ['#s'] });
    const p4 = v2(4, p3);
    const p5 = v2(5, p4);
    const branch = v2(6, g0, { retired: ['#s'] });
    for (const s of [g0, p1, p2, p3, p4, p5, branch]) appendStrand(wdir, s);

    await applyGrades(root, gradeFabric(root, { window: 2 }), '2026-06-27T01:00:00.000Z');
    const index = symbolSurvivalIndex(readGradeSidecar(root));
    // p1/p2/p3 each survived on their own line — 3 graded survivals, none overturned
    // (the concurrent retire never reached them). Under ledger-linear grading the
    // retire would overturn all three → survival 0/3 → a false HELD.
    expect(index.get('#s')).toEqual({ survived: 3, overturned: 0, graded: 3, survival: 1 });
    const esc = evaluateEscalation({ status: 'CLEAN', confidence: 'independent', agentChanged: ['#s'] }, index);
    expect(esc).toBeNull();
  });
});

describe('evaluateEscalation — the ONE consumer rule (pure over decision + sidecar snapshot)', () => {
  const rows = (spec: Array<[sym: string, survived: number, overturned: number]>): GradeSidecarRow[] => {
    const out: GradeSidecarRow[] = [];
    let n = 0;
    for (const [sym, s, o] of spec) {
      for (let i = 0; i < s; i++)
        out.push({ at: 't', pickId: `pick:v0:${sym}-s${n++}`, outcome: 'survived', authoredSymbols: [sym], overturnedSymbols: [] });
      for (let i = 0; i < o; i++)
        out.push({ at: 't', pickId: `pick:v0:${sym}-o${n++}`, outcome: 'overturned', authoredSymbols: [sym], overturnedSymbols: [sym] });
    }
    return out;
  };
  const clean = (
    confidence: 'linked' | 'independent',
    agentChanged: string[],
  ): { status: 'CLEAN'; confidence: 'linked' | 'independent'; agentChanged: string[] } => ({
    status: 'CLEAN',
    confidence,
    agentChanged,
  });

  it('holds an independent-CLEAN touching a below-floor symbol (1/4 survival)', () => {
    const index = symbolSurvivalIndex(rows([['#s', 1, 3]]));
    const esc = evaluateEscalation(clean('independent', ['#s']), index);
    expect(esc).toEqual({ symbol: '#s', survival: 0.25, graded: 4, floor: SURVIVAL_FLOOR, kMin: K_MIN_GRADED });
  });

  it('takes the MIN across touched symbols', () => {
    const index = symbolSurvivalIndex(rows([['#good', 3, 0], ['#bad', 1, 3]]));
    const esc = evaluateEscalation(clean('independent', ['#good', '#bad']), index);
    expect(esc?.symbol).toBe('#bad');
  });

  it('never fires: linked CLEAN / FAST_ADMIT / healthy survival / n<K / no data', () => {
    const low = symbolSurvivalIndex(rows([['#s', 1, 3]]));
    expect(evaluateEscalation(clean('linked', ['#s']), low)).toBeNull();
    expect(evaluateEscalation({ status: 'FAST_ADMIT', confidence: null, agentChanged: ['#s'] }, low)).toBeNull();
    expect(evaluateEscalation(clean('independent', ['#s']), symbolSurvivalIndex(rows([['#s', 3, 0]])))).toBeNull(); // 3/3
    expect(evaluateEscalation(clean('independent', ['#s']), symbolSurvivalIndex(rows([['#s', 1, 1]])))).toBeNull(); // n=2 < K
    expect(evaluateEscalation(clean('independent', ['#s']), symbolSurvivalIndex([]))).toBeNull(); // empty sidecar
  });

  it('exactly AT the floor does not hold (< floor, not ≤)', () => {
    const index = symbolSurvivalIndex(rows([['#s', 2, 2]])); // 0.5 == floor
    expect(evaluateEscalation(clean('independent', ['#s']), index)).toBeNull();
  });

  it('pre-A2 rows (no authoredSymbols) carry no symbol key — skipped, not miscounted', () => {
    const legacy: GradeSidecarRow[] = [
      { at: 't', pickId: 'pick:v0:legacy1', outcome: 'overturned' },
      { at: 't', pickId: 'pick:v0:legacy2', outcome: 'survived' },
    ];
    expect(symbolSurvivalIndex(legacy).size).toBe(0);
  });
});

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

function strand(seq: number, over: Partial<Strand> & { born?: string[]; retired?: string[]; changed?: string[] } = {}): Strand {
  const { born = [], retired = [], changed = [], pickId: _drop, ...rest } = over;
  // A REAL self-consistent v1 pickId so the rewriteFabric identity guard (applyGrades)
  // recomputes to the stored id (grading only moves calibratedConfidence, excluded).
  const body: StrandBody = {
    schemaVersion: 1,
    seq,
    stateId: `state:v0:seq${seq}`,
    parentStateId: seq === 0 ? null : `state:v0:seq${seq - 1}`,
    actor: 'tester',
    intent: `seq ${seq}`,
    recordedAt: '2026-06-27T00:00:00.000Z',
    objectCount: 10,
    delta: { born, retired, contractChanged: changed, renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    ...rest,
  };
  return { ...body, pickId: computePickId(body) };
}

describe('gradeFabric · survive / overturn / pending', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-grade-'));
    const wdir = warplineDirOf(root);
    // 0 genesis; 1 pick(#a,#b); 2 pick(#c) retires #a; 3 LINKED admit(#x);
    // 4 INDEPENDENT admit(#y) retires #x; 5 pick(#z); 6 pick(#w)
    appendStrand(wdir, strand(0));
    appendStrand(wdir, strand(1, { born: ['#a', '#b'] }));
    appendStrand(wdir, strand(2, { born: ['#c'], retired: ['#a'] }));
    appendStrand(wdir, strand(3, { born: ['#x'], calibratedConfidence: 0.9, authoredBy: { agentId: 'agent-a' } }));
    appendStrand(wdir, strand(4, { born: ['#y'], retired: ['#x'], calibratedConfidence: 0.6, authoredBy: { agentId: 'agent-b' } }));
    appendStrand(wdir, strand(5, { born: ['#z'] }));
    appendStrand(wdir, strand(6, { born: ['#w'] }));
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

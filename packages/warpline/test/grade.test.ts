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
import { gradeFabric, applyGrades } from '../src/fabric/grade.js';
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
    appendStrand(wdir, strand(3, { born: ['#x'], calibratedConfidence: 0.9 }));
    appendStrand(wdir, strand(4, { born: ['#y'], retired: ['#x'], calibratedConfidence: 0.6 }));
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
});

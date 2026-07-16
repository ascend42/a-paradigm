/**
 * fabric-verify-v3.test — verify on a real PICK-DAG (V3.1 §3.1–4 + V3.2 §3.5).
 *
 * Fixtures live in a temp .warpline with a REAL object store (bindings re-derive,
 * step 4) — the live repo fabric is never touched. Covers:
 *   - a green pure-v3 diamond (genesis → concurrent A/B → weave) verifies clean;
 *   - a green MIXED v2→v3 fabric (the epoch boundary shape, pre-anchor);
 *   - tamper → pickId-mismatch; dangling parent → parent-unresolved;
 *   - child-before-parent arrival → causality-violation;
 *   - two parentless geneses → multiple-genesis;
 *   - an unbound v3 strand → missing-binding (bind-on-seal is structural);
 *   - a ref naming an absent strand → ref-unresolved (HARD);
 *   - a headless tip no ref names → REPORTED abandoned, not a failure.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { verifyFabric } from '../src/fabric/verify.js';
import { warplineDirOf, appendStrand } from '../src/fabric/fabric.js';
import { buildStrandV3, computePickId, type Strand, type StrandBody, type StrandV3Input } from '../src/fabric/strand.js';
import { writeRef } from '../src/fabric/refs.js';
import { ObjectStore } from '../src/warp/object-store.js';

const EMPTY_DELTA = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

describe('verifyFabric · v3 DAG (§3.1–4) + refs (§3.5)', () => {
  let root: string;
  let wdir: string;
  let treeA: string; // a real, re-derivable binding tree
  let treeR: string; // a distinct tree for the weave result

  function mk(over: Partial<StrandV3Input>): Strand {
    return buildStrandV3({
      parents: [],
      stateId: 'state:v0:abc',
      actor: 'tester',
      authoredBy: { agentId: 'kit' },
      intent: 'strand',
      recordedAt: '2026-07-16T00:00:00.000Z',
      objectCount: 1,
      delta: { ...EMPTY_DELTA },
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      binding: { treeId: treeA, gitOid: null },
      ...over,
    });
  }

  /** genesis → concurrent A/B → weave, appended in causal order; selvage ref at W. */
  function seedDiamond(): { G: Strand; A: Strand; B: Strand; W: Strand } {
    const G = mk({ intent: 'genesis' });
    const A = mk({ intent: 'agent A', actor: 'alice', parents: [G.pickId], recordedAt: '2026-07-16T00:01:00.000Z' });
    const B = mk({ intent: 'agent B', actor: 'bob', parents: [G.pickId], recordedAt: '2026-07-16T00:02:00.000Z' });
    const W = mk({
      intent: 'weave A+B',
      parents: [A.pickId, B.pickId],
      recordedAt: '2026-07-16T00:03:00.000Z',
      merge: { algo: 'warpline-merge3-v1', base: treeA, ours: treeA, theirs: treeA, result: treeR },
      binding: { treeId: treeR, gitOid: null },
    });
    for (const s of [G, A, B, W]) appendStrand(wdir, s);
    writeRef(wdir, 'selvage', W.pickId);
    return { G, A, B, W };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-verify-v3-'));
    wdir = warplineDirOf(root);
    const store = new ObjectStore(root);
    const blob = store.putBlob(Buffer.from('v3 fixture bytes\n'));
    treeA = store.putTree([{ mode: '100644', name: 'a.txt', id: blob }]);
    const blob2 = store.putBlob(Buffer.from('woven bytes\n'));
    treeR = store.putTree([{ mode: '100644', name: 'a.txt', id: blob2 }]);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a green v3 diamond verifies clean (closure + causality + acyclic + refs)', () => {
    seedDiamond();
    const r = verifyFabric(root); // requireAnchor default: no v1 strands ⇒ no anchor needed
    expect(r.failures).toEqual([]);
    expect(r.v3Dag).toEqual({ count: 4, ok: true });
    expect(r.v2Chain.count).toBe(0);
    expect(r.abandonedHeads).toEqual([]);
  });

  it('a green MIXED v2→v3 fabric: the first v3 strand parents the v2 tip pickId (§5 shape)', () => {
    const mkV2 = (seq: number, parentPickId: string | null): Strand => {
      const body: StrandBody = {
        schemaVersion: 2, seq, parentPickId,
        stateId: `state:v0:v2-${seq}`, parentStateId: seq ? `state:v0:v2-${seq - 1}` : null,
        actor: 'tester', intent: `v2 strand ${seq}`, recordedAt: `2026-07-15T00:0${seq}:00.000Z`,
        objectCount: 1, delta: { ...EMPTY_DELTA }, calibratedConfidence: null,
        provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      };
      return { ...body, pickId: computePickId(body) };
    };
    const v2a = mkV2(0, null);
    const v2b = mkV2(1, v2a.pickId);
    const v3 = mk({ intent: 'first v3 — parents the v2 tip', parents: [v2b.pickId], recordedAt: '2026-07-16T00:04:00.000Z' });
    for (const s of [v2a, v2b, v3]) appendStrand(wdir, s);
    const r = verifyFabric(root);
    expect(r.failures).toEqual([]);
    expect(r.v2Chain).toEqual({ count: 2, ok: true });
    expect(r.v3Dag).toEqual({ count: 1, ok: true });
  });

  it('tampering a v3 body → pickId-mismatch (HARD)', () => {
    seedDiamond();
    const p = path.join(wdir, 'fabric.jsonl');
    const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
    const s = JSON.parse(lines[1]) as Strand;
    s.intent = 'forged intent';
    lines[1] = JSON.stringify(s);
    fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
    const r = verifyFabric(root);
    expect(r.failures.map((f) => f.kind)).toContain('pickId-mismatch');
    expect(r.v3Dag.ok).toBe(false);
  });

  it('a dangling parent → parent-unresolved (truncation/forgery evidence, HARD)', () => {
    const { W } = seedDiamond();
    const orphan = mk({ intent: 'orphan', parents: ['pick:v3:' + 'f'.repeat(64)], recordedAt: '2026-07-16T00:09:00.000Z' });
    appendStrand(wdir, orphan);
    writeRef(wdir, 'selvage', W.pickId, W.pickId); // keep the ref resolvable
    const r = verifyFabric(root);
    const kinds = r.failures.map((f) => f.kind);
    expect(kinds).toContain('parent-unresolved');
    expect(kinds).not.toContain('pickId-mismatch'); // the orphan itself hashes honestly
  });

  it('child arriving before its parent → causality-violation (causal-append invariant)', () => {
    const G = mk({ intent: 'genesis' });
    const A = mk({ intent: 'child', parents: [G.pickId], recordedAt: '2026-07-16T00:01:00.000Z' });
    appendStrand(wdir, A); // child FIRST — an appender that could not yet see the parent
    appendStrand(wdir, G);
    const r = verifyFabric(root);
    expect(r.failures.map((f) => f.kind)).toContain('causality-violation');
    expect(r.v3Dag.ok).toBe(false);
  });

  it('two parentless geneses → multiple-genesis', () => {
    appendStrand(wdir, mk({ intent: 'genesis one' }));
    appendStrand(wdir, mk({ intent: 'genesis two', recordedAt: '2026-07-16T00:01:00.000Z' }));
    const r = verifyFabric(root);
    expect(r.failures.map((f) => f.kind)).toContain('multiple-genesis');
  });

  it('an unbound v3 strand → missing-binding (bind-on-seal is the only write path)', () => {
    // buildStrandV3 refuses to make one, so forge the body directly (the attack shape).
    const body: StrandBody = {
      schemaVersion: 3, parents: [], stateId: 'state:v0:abc', actor: 'tester',
      authoredBy: { agentId: null }, intent: 'unbound forge', recordedAt: '2026-07-16T00:00:00.000Z',
      objectCount: 1, delta: { ...EMPTY_DELTA }, provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    };
    appendStrand(wdir, { ...body, pickId: computePickId(body) });
    const r = verifyFabric(root);
    expect(r.failures.map((f) => f.kind)).toContain('missing-binding');
  });

  it('a ref naming an absent strand → ref-unresolved (HARD)', () => {
    seedDiamond();
    writeRef(wdir, 'feature-x', 'pick:v3:' + '0'.repeat(64));
    const r = verifyFabric(root);
    const f = r.failures.find((x) => x.kind === 'ref-unresolved');
    expect(f).toBeDefined();
    expect(f!.detail).toMatch(/feature-x/);
  });

  it('a headless tip no ref names is REPORTED abandoned — never a failure (§3.5)', () => {
    const { G, W } = seedDiamond();
    const stray = mk({ intent: 'lost race, never re-published', parents: [G.pickId], recordedAt: '2026-07-16T00:08:00.000Z' });
    appendStrand(wdir, stray);
    writeRef(wdir, 'selvage', W.pickId, W.pickId);
    const r = verifyFabric(root);
    expect(r.failures).toEqual([]); // abandoned ≠ broken
    expect(r.abandonedHeads).toEqual([stray.pickId]);
  });
});

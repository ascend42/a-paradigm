/**
 * native-loop-no-git.test — PHASE 0 EXIT TEST (arky-architecture.md §4:
 * "the full loop runs green in a directory with no `.git` at all"; I12).
 *
 * A fixture directory that was NEVER a git repo — no `git init`, no .git,
 * nothing — runs the whole native write path:
 *
 *   genesis propose/admit → fork(A,B) → A edits → propose(+claim) → admit
 *   (fast-forward) → B admits concurrently (CLEAN weave, merged bytes restored
 *   back into B's worktree) → C×D contradict (KNOT) → knot payload → resolve
 *   (v3 council weave) → restore HEAD byte-identically into a fresh dir.
 *
 * Also pinned: every strand is v3 with git-null provenance; propose advances
 * ONLY the scratch ref; a CLAIM-BREACH refuses unsealed on the native path;
 * `fabric verify` authenticates the resulting pure-v3 DAG.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  forkNative,
  proposeNative,
  admitNative,
  resolveNative,
} from '../src/fabric/native.js';
import { restore } from '../src/fabric/restore.js';
import { readKnotPayload } from '../src/fabric/knot-payload.js';
import { warplineDirOf, readFabric } from '../src/fabric/fabric.js';
import { readRef } from '../src/fabric/refs.js';
import { readScratch } from '../src/fabric/scratch.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { createClaim, persistClaim } from '../src/fabric/claim.js';

const MOD = 'src/mod.ts';
const BASE = 'export function foo() { return 1; }\nexport function bar() { return 2; }\n';

function write(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function read(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

/** Assert no .git exists anywhere under `dir` (the loop's standing premise). */
function assertNoGit(dir: string): void {
  const walk = (d: string): void => {
    for (const name of fs.readdirSync(d)) {
      expect(name).not.toBe('.git');
      const full = path.join(d, name);
      if (fs.lstatSync(full).isDirectory()) walk(full);
    }
  };
  walk(dir);
}

describe('PHASE 0 exit test — the full native loop with no .git anywhere', () => {
  let root: string; // the project dir (fabric home) — never a git repo
  let dirA: string;
  let dirB: string;
  let dirC: string;
  let dirD: string;
  let fresh: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-native-root-'));
    dirA = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-native-A-'));
    dirB = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-native-B-'));
    dirC = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-native-C-'));
    dirD = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-native-D-'));
    fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-native-fresh-'));
    write(root, MOD, BASE);
    write(root, 'readme.md', 'native-first fixture\n');
  });

  afterAll(() => {
    for (const d of [root, dirA, dirB, dirC, dirD, fresh]) {
      fs.rmSync(d, { recursive: true, force: true });
    }
  });

  it('runs the whole loop green', async () => {
    // ── genesis: propose seals a parentless v3 strand; admit fast-forwards refs/heads/selvage
    const g = await proposeNative(root, { worktree: root, agentId: 'genesis', intent: 'genesis' });
    expect(g.noop).toBe(false);
    expect(g.strand!.schemaVersion).toBe(3);
    expect(g.strand!.parents).toEqual([]);
    expect(g.strand!.provenance.gitCommit).toBeNull();
    expect(readRef(warplineDirOf(root), 'selvage')).toBeNull(); // propose NEVER moves the selvage

    const ga = await admitNative(root, { worktree: root, agentId: 'genesis' });
    expect(ga.sealed).toBe(true);
    expect(ga.decision.status).toBe('FAST_ADMIT');
    expect(ga.refusal).toBeUndefined(); // a sealing admission NEVER carries a refusal
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(g.strand!.pickId);

    // ── fork A and B at the same selvage (true concurrency), restored worktrees
    const fa = forkNative(root, 'A', { into: dirA });
    const fb = forkNative(root, 'B', { into: dirB });
    expect(fa.base).toBe(g.strand!.pickId);
    expect(fb.base).toBe(g.strand!.pickId);
    expect(read(dirA, MOD)).toBe(BASE);

    // ── A: edit foo → propose (with claim) → admit = fast-forward
    write(dirA, MOD, 'export function foo() { return 10; }\nexport function bar() { return 2; }\n');
    const pa = await proposeNative(root, {
      worktree: dirA,
      agentId: 'A',
      intent: 'A: foo returns 10',
      claim: { claimedSymbols: ['#code:src/mod.ts::foo'] },
    });
    expect(pa.noop).toBe(false);
    expect(pa.claimId).toBeDefined();
    expect(pa.strand!.parents).toEqual([g.strand!.pickId]);
    // propose advanced ONLY A's scratch ref
    expect(readScratch(root, 'A')).toBe(pa.strand!.pickId);
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(g.strand!.pickId);

    const aa = await admitNative(root, { worktree: dirA, agentId: 'A', claim: pa.claimId });
    expect(aa.sealed).toBe(true);
    expect(aa.decision.status).toBe('FAST_ADMIT');
    expect(aa.claim?.breach).toBe(false);
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(pa.strand!.pickId); // ff — the scratch strand IS the tip
    expect(readScratch(root, 'A')).toBeNull(); // cleared after admission

    // ── B (forked BEFORE A admitted): edit bar → propose → admit = CLEAN weave
    write(dirB, MOD, 'export function foo() { return 1; }\nexport function bar() { return 20; }\n');
    const pb = await proposeNative(root, {
      worktree: dirB,
      agentId: 'B',
      intent: 'B: bar returns 20',
      claim: { claimedSymbols: ['#code:src/mod.ts::bar'] },
    });
    expect(pb.strand!.parents).toEqual([g.strand!.pickId]); // base pinned at fork time (I9)

    const ab = await admitNative(root, { worktree: dirB, agentId: 'B', claim: pb.claimId });
    expect(ab.decision.status).toBe('CLEAN');
    expect(ab.sealed).toBe(true);
    expect(ab.refusal).toBeUndefined();
    expect(ab.merged?.conflicts).toEqual([]);
    expect(ab.coverage).toBeDefined();
    expect(ab.strand!.parents).toEqual([pa.strand!.pickId, pb.strand!.pickId]); // the weave
    expect(ab.strand!.merge?.result).toBe(ab.strand!.binding?.treeId);
    // step 5 — the merged bytes were restored back into B's worktree:
    expect(ab.restoredEntries).toBeGreaterThan(0);
    expect(read(dirB, MOD)).toBe('export function foo() { return 10; }\nexport function bar() { return 20; }\n');

    // ── CLAIM-BREACH on the native path: C claims bar but edits foo too
    const fc = forkNative(root, 'C', { into: dirC });
    const fd = forkNative(root, 'D', { into: dirD });
    expect(fc.base).toBe(ab.strand!.pickId);
    expect(fd.base).toBe(ab.strand!.pickId);

    // D advances the selvage with foo → 300 (fast-forward)
    write(dirD, MOD, 'export function foo() { return 300; }\nexport function bar() { return 20; }\n');
    const pd = await proposeNative(root, { worktree: dirD, agentId: 'D', intent: 'D: foo returns 300' });
    const ad = await admitNative(root, { worktree: dirD, agentId: 'D' });
    expect(ad.sealed).toBe(true);
    expect(ad.decision.status).toBe('FAST_ADMIT');

    // C contradicts on foo → 400 (forked before D admitted) — a genuine KNOT
    write(dirC, MOD, 'export function foo() { return 400; }\nexport function bar() { return 20; }\n');
    const narrow = createClaim({ agentId: 'C', claimedSymbols: ['#nothing-real'], intent: 'too narrow' });
    persistClaim(root, narrow);
    const pc = await proposeNative(root, { worktree: dirC, agentId: 'C', intent: 'C: foo returns 400' });
    expect(pc.noop).toBe(false);

    // The claim gate fires BEFORE the knot machinery (honesty first):
    const breach = await admitNative(root, { worktree: dirC, agentId: 'C', claim: narrow.claimId });
    expect(breach.decision.status).toBe('CLAIM-BREACH');
    expect(breach.sealed).toBe(false);
    expect(breach.claim?.excess.join(',')).toContain('foo');
    expect(readScratch(root, 'C')).toBe(pc.strand!.pickId); // the work is kept

    // refusal:v1 rides EVERY refusing native verdict (T-2026-07-21-007) — the
    // native path is the one agents actually use, so the F4 carrier must be here.
    expect(breach.refusal?.schemaVersion).toBe('refusal:v1');
    expect(breach.refusal?.code).toBe('CLAIM_BREACH');
    expect(breach.refusal?.verdict).toBe('CLAIM-BREACH');
    expect(breach.refusal?.retriable).toBe('retry-with-override');
    expect(breach.refusal?.override).toEqual({ flag: 'acceptBreach', principal: 'human' });
    expect(breach.refusal?.pointers.claimId).toBe(narrow.claimId);
    expect(breach.refusal?.pointers.symbols?.join(',')).toContain('foo');
    // the ladder's re-admit step is copy-paste runnable ON THIS PATH (native):
    const readmit = breach.refusal?.next.find((n) => n.verb === 'admit');
    expect(readmit?.principal).toBe('human');
    expect(readmit?.params).toMatchObject({ native: 'true', claim: narrow.claimId, acceptBreach: 'true' });

    // Without the claim: the true verdict — KNOT, payload persisted, selvage unmoved
    const knot = await admitNative(root, { worktree: dirC, agentId: 'C' });
    expect(knot.decision.status).toBe('KNOT');
    expect(knot.sealed).toBe(false);
    expect(knot.knotPayloadId).toBeDefined();
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(pd.strand!.pickId);

    // The KNOT refusal points at the PERSISTED payload and leads with knot.show —
    // every pointer dereferences (F4).
    expect(knot.refusal?.code).toBe('GATE_REFUSED');
    expect(knot.refusal?.verdict).toBe('KNOT');
    expect(knot.refusal?.retriable).toBe('retry-after-resolve');
    expect(knot.refusal?.pointers.knotPayloadId).toBe(knot.knotPayloadId);
    expect(knot.refusal?.next[0]).toEqual({
      verb: 'knot.show',
      params: { selector: knot.knotPayloadId! },
      requires: [],
      principal: 'agent',
    });
    expect(knot.refusal?.contested.map((c) => c.symbol).join(',')).toContain('foo');

    const payload = readKnotPayload(root, knot.knotPayloadId!);
    expect(payload).not.toBeNull();
    expect(payload!.contested.map((c) => c.symbol).join(',')).toContain('foo');
    expect(payload!.ours.treeId).toBe(pc.strand!.binding!.treeId); // both sides durable, native
    expect(payload!.theirs.treeId).toBe(pd.strand!.binding!.treeId);

    // ── RESOLVE: the human decides foo → 500; sealed as a v3 council weave
    write(dirC, MOD, 'export function foo() { return 500; }\nexport function bar() { return 20; }\n');
    const rr = await resolveNative(root, { worktree: dirC, agentId: 'C', reason: 'took 500 — supersedes both', decidedBy: 'human' });
    expect(rr.strand.schemaVersion).toBe(3);
    expect(rr.strand.parents).toEqual([pd.strand!.pickId, pc.strand!.pickId]);
    expect(rr.resolution.contended.join(',')).toContain('foo');
    expect(readRef(warplineDirOf(root), 'selvage')).toBe(rr.strand.pickId);

    // ── RESTORE: HEAD reproduces the resolved tree byte-identically, git absent
    const res = restore(root, { selector: 'HEAD', to: fresh, force: true });
    expect(res.pickId).toBe(rr.strand.pickId);
    expect(read(fresh, MOD)).toBe(read(dirC, MOD));
    expect(read(fresh, 'readme.md')).toBe('native-first fixture\n');

    // ── the standing premise: NO git anywhere, ever
    assertNoGit(root);
    assertNoGit(dirA);
    assertNoGit(dirB);
    assertNoGit(dirC);
    assertNoGit(dirD);

    // every strand: v3, git-null provenance (I4), bound (bind-on-seal)
    const fabric = readFabric(warplineDirOf(root));
    expect(fabric.length).toBeGreaterThanOrEqual(7); // genesis, A, B-weave, D, C, resolve (+)
    for (const s of fabric) {
      expect(s.schemaVersion).toBe(3);
      expect(s.provenance.gitCommit).toBeNull();
      expect(s.provenance.treeSha).toBeNull();
      expect(s.binding?.treeId).toBeDefined();
    }

    // and the pure-v3 DAG authenticates
    const report = verifyFabric(root);
    expect(report.failures).toEqual([]);
    expect(report.v3Dag.ok).toBe(true);
  }, 240_000);
});

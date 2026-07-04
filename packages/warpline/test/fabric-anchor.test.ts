/**
 * fabric-anchor.test — the v1-prefix EPOCH ANCHOR (docs/specs/warpline-v1-anchor.md).
 *
 * Proves the anchor closes the live exploits and freezes the v1 prefix:
 *   T-1 (HIGH-A)  binding injection onto a v1 strand → anchor-mismatch, exit 1;
 *                 restore refuses; the WRITE path (rewriteFabric) refuses too.
 *   T-2 (HIGH-B)  grandfathered body + manifest bodyHash co-tamper → anchor-manifest-
 *                 mismatch + anchor-mismatch, exit 1.
 *   T-3 (mint)    add a {pickId,bodyHash} entry for a real v1 strand → manifest digest
 *                 moves + grandfatheredCount named, exit 1.
 *   T-4 (MED-C)   rewrite a non-tip v1 body + recompute its self-hash → anchor-mismatch.
 *   T-5 (tip-app) append a fresh self-consistent v1 strand after the tip → v1-out-of-prefix.
 *   T-6..T-10     freeze / attest-once / no-downgrade / bootstrap.
 *   T-11/T-12     attest corroboration + a clean anchored fabric verifies exit 0.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { absorb } from '../src/absorb.js';
import { ObjectStore } from '../src/warp/object-store.js';
import { snapshotDir } from '../src/warp/snapshot.js';
import { WarpStore } from '../src/warp/store.js';
import {
  warplineDirOf,
  readFabric,
  readSelvage,
  appendStrand,
  writeSelvage,
  rewriteFabric,
  readLegacyManifest,
} from '../src/fabric/fabric.js';
import {
  computePickId,
  computePickIdWholeBody,
  computeLegacyBodyHash,
  type Strand,
  type StrandBody,
} from '../src/fabric/strand.js';
import { attestFabric } from '../src/fabric/anchor.js';
import { backfillV1Bindings } from '../src/fabric/backfill.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { resolveSelector } from '../src/fabric/select.js';
import { gradeFabric, applyGrades } from '../src/fabric/grade.js';

const execFileAsync = promisify(execFile);
const NOW = '2026-07-02T00:00:00.000Z';
const EMPTY = { born: [], retired: [], contractChanged: [], renamedNoop: 0 };

/** Rewrite the raw ledger, bypassing the rewriteFabric guard (an attacker with fs access). */
function rawWrite(root: string, strands: Strand[]): void {
  fs.writeFileSync(warplineDirOf(root) + '/fabric.jsonl', strands.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
}
const V1SEQ = (seq: number): string => `state:v0:v1seq${seq}`;

interface Fixture {
  root: string;
  store: WarpStore;
  objects: ObjectStore;
  cleanTree: string;
  attackerTree: string;
  /** the number of v1 strands (seq 0..N-1); the anchor seals at seq N. */
  v1Count: number;
}

/**
 * Build an UNANCHORED fixture: a git repo whose .warpline holds a synthetic v1 prefix
 * (real hashing eras, one grandfathered graded-over strand, every strand bound to a
 * real tree) with the tip landing on a REAL absorbed state (so attest can seal a
 * meaning-no-op over it). Commits .warpline so attest's git corroboration can match.
 */
async function buildFixture(): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-anchor-'));
  const git = async (...a: string[]): Promise<void> => {
    await execFileAsync('git', a, { cwd: root, encoding: 'utf8' });
  };
  await git('init', '-q', '-b', 'base');
  await git('config', 'user.email', 'm@warpline.test');
  await git('config', 'user.name', 'Warpline M');
  await git('config', 'commit.gpgsign', 'false');

  // A real .purpose so absorb lifts a genuine WarpState for the v1 tip.
  fs.writeFileSync(
    path.join(root, '.purpose'),
    'version: "2.0"\ndescription: anchor fixture\ncomponents:\n  alpha:\n    description: A\n    type: module\n',
    'utf8',
  );
  // Two real byte trees in the store: clean (v1 bindings) + attacker (HIGH-A injection).
  fs.mkdirSync(path.join(root, 'payload'));
  fs.writeFileSync(path.join(root, 'payload', 'f.txt'), 'clean payload\n', 'utf8');
  fs.mkdirSync(path.join(root, 'attacker'));
  fs.writeFileSync(path.join(root, 'attacker', 'f.txt'), 'ATTACKER CONTROLLED\n', 'utf8');
  const objects = new ObjectStore(root);
  const cleanTree = snapshotDir(objects, path.join(root, 'payload')).treeId;
  const attackerTree = snapshotDir(objects, path.join(root, 'attacker')).treeId;

  const store = new WarpStore(root, { diskCache: true });
  const tipState = await absorb('WORKTREE', { cwd: root });
  store.putState(tipState);

  const wdir = warplineDirOf(root);
  fs.mkdirSync(path.join(wdir, 'refs'), { recursive: true });

  const N = 10; // v1 prefix length (seq 0..9)
  const cleanBinding = { treeId: cleanTree, gitOid: null };
  const grandfatheredSeq = 3;

  const bodyOf = (seq: number, stateId: string): StrandBody => ({
    schemaVersion: 1,
    seq,
    stateId,
    parentStateId: seq === 0 ? null : V1SEQ(seq - 1),
    actor: 'ascend',
    intent: `v1 seq ${seq}`,
    recordedAt: NOW,
    objectCount: 5,
    delta: { ...EMPTY },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    binding: cleanBinding,
  });

  const manifest: { pickId: string; bodyHash: string }[] = [];
  for (let seq = 0; seq < N; seq++) {
    const stateId = seq === N - 1 ? tipState.stateId : V1SEQ(seq);
    if (seq === grandfatheredSeq) {
      // A graded-over strand: sealed under the legacy WHOLE-BODY rule (over the
      // pre-grade body, confidence null, no binding), then #grade overwrote the hashed
      // confidence AND a binding was backfilled — so it reproduces under NO known rule
      // but its PINNED bodyHash (excludes confidence+binding) still matches.
      const original: StrandBody = {
        schemaVersion: 1,
        seq,
        stateId,
        parentStateId: V1SEQ(seq - 1),
        actor: 'ascend',
        intent: `v1 seq ${seq} (graded-over)`,
        recordedAt: NOW,
        objectCount: 5,
        delta: { ...EMPTY },
        calibratedConfidence: null,
        provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      };
      const pickId = computePickIdWholeBody(original);
      const stored: Strand = { ...original, pickId, calibratedConfidence: 0.8, binding: cleanBinding };
      appendStrand(wdir, stored);
      manifest.push({ pickId, bodyHash: computeLegacyBodyHash({ ...original, calibratedConfidence: 0.8, binding: cleanBinding }) });
    } else {
      const body = bodyOf(seq, stateId);
      appendStrand(wdir, { ...body, pickId: computePickId(body) });
    }
  }
  fs.writeFileSync(
    path.join(wdir, 'fabric-legacy.json'),
    JSON.stringify({ reason: 'anchor fixture graded-over residue', grandfathered: manifest }, null, 2),
    'utf8',
  );
  writeSelvage(wdir, tipState.stateId);

  // Commit .warpline so attest's git corroboration finds a matching committed state.
  await git('add', '-A');
  await git('commit', '-q', '-m', 'seed v1 prefix + manifest');

  return { root, store, objects, cleanTree, attackerTree, v1Count: N };
}

async function attest(fx: Fixture): Promise<Strand> {
  const r = await attestFabric(fx.root, { cwd: fx.root, now: NOW, agentId: 'kit' });
  return r.strand;
}

describe('v1 anchor — attest + clean verify (T-12)', () => {
  let fx: Fixture;
  beforeEach(async () => (fx = await buildFixture()));
  afterEach(() => fs.rmSync(fx.root, { recursive: true, force: true }));

  it('a clean anchored fabric verifies exit-equivalent 0 with anchor.ok', async () => {
    const anchor = await attest(fx);
    expect(anchor.attests?.epoch).toBe('v1');
    expect(anchor.attests?.prefixCount).toBe(fx.v1Count);
    const r = verifyFabric(fx.root);
    expect(r.failures).toEqual([]);
    expect(r.anchor).toEqual({ present: true, ok: true, corroboration: anchor.attests!.corroboration.gitCommit });
    expect(r.v1Prefix.count).toBe(fx.v1Count);
    expect(r.legacyUnverifiable.count).toBe(1); // the graded-over grandfathered strand
    // the anchor's attests payload is IN its pickId (mutating a digest field breaks the chain)
    const { pickId, ...body } = anchor;
    expect(computePickId(body)).toBe(pickId);
  });

  it('a v1 selector restores through a valid anchor (gate passes)', async () => {
    await attest(fx);
    const res = resolveSelector(warplineDirOf(fx.root), '5');
    expect(res.treeId).toBe(fx.cleanTree);
  });
});

describe('v1 anchor — exploit reproductions flip to exit 1', () => {
  let fx: Fixture;
  let wdir: string;
  beforeEach(async () => {
    fx = await buildFixture();
    wdir = warplineDirOf(fx.root);
  });
  afterEach(() => fs.rmSync(fx.root, { recursive: true, force: true }));

  it('T-1 HIGH-A: inject a binding onto a v1 strand → anchor-mismatch (exit 1); restore refuses; write path refuses', async () => {
    await attest(fx);
    const fabric = readFabric(wdir); // the clean, on-disk ledger
    // The forged binding: repoint v1 seq 5 at attacker bytes.
    const tampered = fabric.map((s) => (s.seq === 5 ? { ...s, binding: { treeId: fx.attackerTree, gitOid: null } } : s));

    // The WRITE path refuses FIRST (§7 freeze — evaluated against the clean on-disk
    // ledger, before any raw fs tamper lands).
    expect(() => rewriteFabric(wdir, tampered)).toThrow(/FROZEN by the epoch/);

    // A raw-fs attacker bypasses rewriteFabric — verify + restore are the backstop.
    rawWrite(fx.root, tampered);
    const r = verifyFabric(fx.root);
    expect(r.failures.some((f) => f.kind === 'anchor-mismatch')).toBe(true); // EXIT 1
    expect(r.anchor.ok).toBe(false);
    expect(() => resolveSelector(wdir, '5')).toThrow(/not \(validly\) attested/);
  });

  it('T-2 HIGH-B: grandfathered body + manifest bodyHash co-tamper → anchor-manifest-mismatch + anchor-mismatch (exit 1)', async () => {
    await attest(fx);
    const fabric = readFabric(wdir);
    const gf = fabric.find((s) => s.intent.includes('graded-over'))!;
    const forged = { ...gf, intent: 'FORGED grandfathered intent' };
    const { pickId: _p, ...forgedBody } = forged;
    rawWrite(fx.root, fabric.map((s) => (s.pickId === gf.pickId ? forged : s)));
    // Co-tamper the manifest bodyHash to the forged body (the HIGH-B move).
    const manifest = readLegacyManifest(wdir)!;
    manifest.grandfathered = manifest.grandfathered.map((e) =>
      e.pickId === gf.pickId ? { ...e, bodyHash: computeLegacyBodyHash(forgedBody) } : e,
    );
    fs.writeFileSync(path.join(wdir, 'fabric-legacy.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const r = verifyFabric(fx.root);
    expect(r.failures.some((f) => f.kind === 'anchor-mismatch')).toBe(true); // strand digest moved
    expect(r.failures.some((f) => f.kind === 'anchor-manifest-mismatch')).toBe(true); // manifest digest moved
    expect(r.anchor.ok).toBe(false); // EXIT 1
  });

  it("T-3 mint: add a {pickId,bodyHash} entry for a real v1 strand → manifest digest moves + count named (exit 1)", async () => {
    await attest(fx);
    const realV1 = readFabric(wdir).find((s) => s.seq === 6)!;
    const { pickId: _p, ...body } = realV1;
    const manifest = readLegacyManifest(wdir)!;
    manifest.grandfathered.push({ pickId: realV1.pickId, bodyHash: computeLegacyBodyHash(body) });
    fs.writeFileSync(path.join(wdir, 'fabric-legacy.json'), JSON.stringify(manifest, null, 2), 'utf8');

    const r = verifyFabric(fx.root);
    const mm = r.failures.find((f) => f.kind === 'anchor-manifest-mismatch');
    expect(mm).toBeTruthy(); // EXIT 1
    expect(mm!.detail).toMatch(/1→2|digest/); // count moved or digest moved
  });

  it('T-4 MED-C: rewrite a non-tip v1 body + recompute its self-hash (self-consistent) → anchor-mismatch (exit 1)', async () => {
    await attest(fx);
    const fabric = readFabric(wdir);
    const victim = fabric.find((s) => s.seq === 2)!;
    const forgedBody = { ...victim, intent: 'MED-C self-consistent forgery' };
    const { pickId: _p, ...b } = forgedBody;
    const selfConsistent = { ...forgedBody, pickId: computePickId(b) }; // reproduces under the v1 rule
    rawWrite(fx.root, fabric.map((s) => (s.seq === 2 ? selfConsistent : s)));

    const r = verifyFabric(fx.root);
    // Per-strand self-hash PASSES (self-consistent), but the anchor digest moved.
    expect(r.failures.some((f) => f.seq === 2 && f.kind === 'pickId-mismatch')).toBe(false);
    expect(r.failures.some((f) => f.kind === 'anchor-mismatch')).toBe(true); // EXIT 1
  });

  it('T-5 tip-append: append a fresh self-consistent v1 strand after the tip + move selvage → v1-out-of-prefix (exit 1)', async () => {
    await attest(fx);
    const fabric = readFabric(wdir);
    const freshBody: StrandBody = {
      schemaVersion: 1,
      seq: fabric.length,
      stateId: 'state:v0:appended',
      parentStateId: fabric[fabric.length - 1].stateId,
      actor: 'attacker',
      intent: 'appended v1 forgery',
      recordedAt: NOW,
      objectCount: 5,
      delta: { ...EMPTY },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      binding: { treeId: fx.attackerTree, gitOid: null },
    };
    const fresh = { ...freshBody, pickId: computePickId(freshBody) };
    rawWrite(fx.root, [...fabric, fresh]);
    writeSelvage(wdir, fresh.stateId);

    const r = verifyFabric(fx.root);
    expect(r.failures.some((f) => f.kind === 'v1-out-of-prefix')).toBe(true); // EXIT 1
    expect(r.anchor.ok).toBe(false);
  });
});

describe('v1 anchor — freeze + attest-once + no-downgrade', () => {
  let fx: Fixture;
  let wdir: string;
  beforeEach(async () => {
    fx = await buildFixture();
    wdir = warplineDirOf(fx.root);
  });
  afterEach(() => fs.rmSync(fx.root, { recursive: true, force: true }));

  it('T-6 freeze: post-anchor rewriteFabric refuses a v1 binding stamp + a v1 confidence change; pass-through of unchanged v1 succeeds', async () => {
    await attest(fx);
    const fabric = readFabric(wdir);
    // Binding stamp on a v1 strand → refused.
    expect(() =>
      rewriteFabric(wdir, fabric.map((s) => (s.seq === 5 ? { ...s, binding: { treeId: fx.attackerTree, gitOid: null } } : s))),
    ).toThrow(/FROZEN by the epoch/);
    // calibratedConfidence change on a v1 strand → refused.
    expect(() =>
      rewriteFabric(wdir, fabric.map((s) => (s.seq === 5 ? { ...s, calibratedConfidence: 0.99 } : s))),
    ).toThrow(/FROZEN by the epoch/);
    // Pass-through of the unchanged ledger → legal (rewrite refuses mutations, not reads).
    expect(() => rewriteFabric(wdir, fabric)).not.toThrow();
  });

  it('T-7 grade: applyGrades over an attested fabric does not throw and leaves v1 ledger bytes frozen', async () => {
    await attest(fx);
    const before = readFabric(wdir).filter((s) => s.schemaVersion < 2).map((s) => s.calibratedConfidence);
    const report = gradeFabric(fx.root);
    // Without the grade.ts freeze-skip, a v1 confidence rewrite would hit the §7 freeze
    // in rewriteFabric and THROW; the skip keeps grade a no-op over frozen v1 strands.
    // (The grade-EVENT sidecar path for gradeable strands is covered by grade.test.ts.)
    await expect(applyGrades(fx.root, report, NOW)).resolves.toBeUndefined();
    const after = readFabric(wdir).filter((s) => s.schemaVersion < 2).map((s) => s.calibratedConfidence);
    expect(after).toEqual(before); // v1 confidences unchanged (frozen)
  });

  it('T-8 attest-once: a second attest refuses; a hand-crafted second anchor → anchor-duplicate; backfill post-anchor refuses', async () => {
    await attest(fx);
    await expect(attestFabric(fx.root, { cwd: fx.root, now: NOW })).rejects.toThrow(/already exists/);
    await expect(backfillV1Bindings(fx.root, { cwd: fx.root })).rejects.toThrow(/attested and frozen/);

    // Hand-craft a second v1 anchor strand appended at the tip.
    const fabric = readFabric(wdir);
    const anchor = fabric.find((s) => s.attests)!;
    const dupBody: StrandBody = {
      schemaVersion: 2,
      seq: fabric.length,
      parentPickId: fabric[fabric.length - 1].pickId,
      stateId: anchor.stateId,
      parentStateId: anchor.stateId,
      actor: 'attacker',
      intent: 'second anchor forgery',
      recordedAt: NOW,
      objectCount: anchor.objectCount,
      delta: { ...EMPTY },
      calibratedConfidence: null,
      provenance: anchor.provenance,
      binding: anchor.binding,
      attests: anchor.attests,
    };
    rawWrite(fx.root, [...fabric, { ...dupBody, pickId: computePickId(dupBody) }]);
    writeSelvage(wdir, anchor.stateId);
    const r = verifyFabric(fx.root);
    expect(r.failures.some((f) => f.kind === 'anchor-duplicate')).toBe(true); // EXIT 1
  });

  it('T-9 no-downgrade: deleting the anchor line (no re-chain) → anchor-missing (exit 1)', async () => {
    await attest(fx);
    const fabric = readFabric(wdir);
    const withoutAnchor = fabric.filter((s) => !s.attests);
    rawWrite(fx.root, withoutAnchor);
    // roll the selvage back to the (now) tip so §6.7 is satisfied — anchor-missing still fires.
    writeSelvage(wdir, withoutAnchor[withoutAnchor.length - 1].stateId);
    const r = verifyFabric(fx.root);
    expect(r.failures.some((f) => f.kind === 'anchor-missing')).toBe(true); // EXIT 1
  });

  it('T-10 bootstrap: an unanchored v1 fabric → anchor-missing + restore refuses; a pure-v2 fabric needs no anchor', async () => {
    // Pre-attest: this fixture is an unanchored v1 fabric.
    const r = verifyFabric(fx.root);
    expect(r.failures.some((f) => f.kind === 'anchor-missing')).toBe(true); // EXIT 1
    expect(() => resolveSelector(wdir, '5')).toThrow(/not \(validly\) attested/);

    // A pure-v2 fabric (no v1 strands) needs no anchor → exit 0.
    const v2root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-purev2-'));
    try {
      const w = warplineDirOf(v2root);
      fs.mkdirSync(path.join(w, 'refs'), { recursive: true });
      const b: StrandBody = {
        schemaVersion: 2,
        seq: 0,
        parentPickId: null,
        stateId: 'state:v0:v2genesis',
        parentStateId: null,
        actor: 'ascend',
        intent: 'v2 genesis',
        recordedAt: NOW,
        objectCount: 1,
        delta: { ...EMPTY },
        calibratedConfidence: null,
        provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
      };
      appendStrand(w, { ...b, pickId: computePickId(b) });
      writeSelvage(w, b.stateId);
      const rr = verifyFabric(v2root);
      expect(rr.failures).toEqual([]); // no v1 strands ⇒ no anchor required, exit 0
      expect(rr.anchor.present).toBe(false);
    } finally {
      fs.rmSync(v2root, { recursive: true, force: true });
    }
  });

  it('T-11 corroboration: attest refuses when the working prefix matches no committed state; succeeds after committing', async () => {
    // Mutate a committed v1 byte in the working tree (no new commit) → corroboration
    // fails. Recompute the pickId over the NEW body so it is self-consistent (passes
    // the precondition verify) but no longer matches any committed state.
    const fabric = readFabric(wdir);
    const victim = fabric.find((s) => s.seq === 4)!;
    const nb = { ...victim, intent: 'uncommitted v1 drift' };
    const { pickId: _drop, ...nbBody } = nb;
    const drifted: Strand = { ...nb, pickId: computePickId(nbBody) };
    rawWrite(fx.root, fabric.map((s) => (s.seq === 4 ? drifted : s)));
    await expect(attestFabric(fx.root, { cwd: fx.root, now: NOW })).rejects.toThrow(/matched NO committed state/);

    // Commit the drift, then attest succeeds and records the matching commit.
    await execFileAsync('git', ['add', '-A'], { cwd: fx.root });
    await execFileAsync('git', ['commit', '-q', '-m', 'commit drift'], { cwd: fx.root });
    const res = await attestFabric(fx.root, { cwd: fx.root, now: NOW });
    expect(res.gitCommit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(readSelvage(wdir)).toBe(res.strand.stateId); // meaning no-op: selvage unchanged
  });
});

describe('v1 anchor — backfill', () => {
  it('objects backfill stamps native bindings on unbound v1 strands from their provenance commit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-backfill-'));
    const git = async (...a: string[]): Promise<void> => {
      await execFileAsync('git', a, { cwd: root, encoding: 'utf8' });
    };
    try {
      await git('init', '-q', '-b', 'base');
      await git('config', 'user.email', 'm@warpline.test');
      await git('config', 'user.name', 'Warpline M');
      await git('config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(root, 'a.txt'), 'hello\n', 'utf8');
      await git('add', '-A');
      await git('commit', '-q', '-m', 'c1');
      const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();

      const wdir = warplineDirOf(root);
      fs.mkdirSync(path.join(wdir, 'refs'), { recursive: true });
      const body: StrandBody = {
        schemaVersion: 1,
        seq: 0,
        stateId: 'state:v0:bf0',
        parentStateId: null,
        actor: 'ascend',
        intent: 'unbound v1',
        recordedAt: NOW,
        objectCount: 1,
        delta: { ...EMPTY },
        calibratedConfidence: null,
        provenance: { ref: 'HEAD', treeSha: null, gitCommit: commit },
        // no binding — backfill must stamp it
      };
      appendStrand(wdir, { ...body, pickId: computePickId(body) });
      writeSelvage(wdir, body.stateId);

      const result = await backfillV1Bindings(root, { cwd: root });
      expect(result.stamped.length).toBe(1);
      expect(result.unbound.length).toBe(0);
      const after = readFabric(wdir)[0];
      expect(after.binding?.treeId).toMatch(/^tree:v1:[0-9a-f]{64}$/);
      expect(after.binding?.gitOid).toBeNull(); // MED-E: gitOid:null deliberately
      // pickId is unchanged (binding is excluded from the v1 pickId).
      expect(after.pickId).toBe(readFabric(wdir)[0].pickId);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);

  it('backfill SKIPS a whole-body-hashed strand (binding is in its pickId) — frozen unbound, no throw', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-bf-wholebody-'));
    const git = async (...a: string[]): Promise<void> => {
      await execFileAsync('git', a, { cwd: root, encoding: 'utf8' });
    };
    try {
      await git('init', '-q', '-b', 'base');
      await git('config', 'user.email', 'm@warpline.test');
      await git('config', 'user.name', 'Warpline M');
      await git('config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(root, 'a.txt'), 'hi\n', 'utf8');
      await git('add', '-A');
      await git('commit', '-q', '-m', 'c1');
      const commit = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();

      const wdir = warplineDirOf(root);
      fs.mkdirSync(path.join(wdir, 'refs'), { recursive: true });
      // A genesis sealed under the WHOLE-BODY rule (like the real seq 0): its pickId
      // folds binding in, so a stamp would forge it — backfill must skip it.
      const body: StrandBody = {
        schemaVersion: 1,
        seq: 0,
        stateId: 'state:v0:wb0',
        parentStateId: null,
        actor: 'ascend',
        intent: 'whole-body genesis',
        recordedAt: NOW,
        objectCount: 1,
        delta: { ...EMPTY },
        calibratedConfidence: null,
        provenance: { ref: 'HEAD', treeSha: null, gitCommit: commit },
      };
      appendStrand(wdir, { ...body, pickId: computePickIdWholeBody(body) });
      writeSelvage(wdir, body.stateId);

      const result = await backfillV1Bindings(root, { cwd: root });
      expect(result.stamped.length).toBe(0);
      expect(result.unbound.some((u) => u.seq === 0 && /whole-body-hashed/.test(u.reason))).toBe(true);
      expect(readFabric(wdir)[0].binding).toBeUndefined(); // still unbound, not forged
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});

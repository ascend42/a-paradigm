/**
 * grandfather-containment.test — Move 2 item 2 (HIGH-2 + MEDIUM-2). The grandfather
 * clause is CONTAINED: each fabric-legacy.json entry pins {pickId, bodyHash}
 * (bodyHash excludes calibratedConfidence/binding/merge so grading stays legal);
 * grandfathering applies ONLY to schemaVersion < 2 strands; a grandfathered strand
 * whose body moved is a HARD verify failure AND a rewriteFabric throw (the clause
 * exempts the retired pickId rule, never the body); manifest membership is sanity-
 * checked at verify time; and the retired bare-pickId format fails closed with a
 * regenerate instruction.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  warplineDirOf,
  appendStrand,
  readFabric,
  readLegacyGrandfathered,
  rewriteFabric,
} from '../src/fabric/fabric.js';
import { gradeFabric, applyGrades } from '../src/fabric/grade.js';
import {
  computePickId,
  computePickIdWholeBody,
  computeLegacyBodyHash,
  type Strand,
  type StrandBody,
} from '../src/fabric/strand.js';
import { verifyFabric } from '../src/fabric/verify.js';

const NOW = '2026-07-01T00:00:00.000Z';

function v1Strand(seq: number, over: Partial<StrandBody> = {}): Strand {
  const body: StrandBody = {
    schemaVersion: 1,
    seq,
    stateId: `state:v0:s${seq}`,
    parentStateId: seq === 0 ? null : `state:v0:s${seq - 1}`,
    actor: 'ascend',
    intent: `v1 seq ${seq}`,
    recordedAt: NOW,
    objectCount: 5,
    delta: { born: seq === 0 ? [] : [`#sym${seq}`], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    ...over,
  };
  return { ...body, pickId: computePickId(body) };
}

/** A graded-over whole-body strand (reproduces under NO known rule — the §7.2 case). */
function gradedOver(seq: number): Strand {
  const sealBody: StrandBody = {
    ...v1Strand(seq),
    calibratedConfidence: 0.8, // hashed at seal under the retired whole-body rule
  };
  delete (sealBody as Partial<Strand>).pickId;
  const sealedPickId = computePickIdWholeBody(sealBody);
  return { ...sealBody, calibratedConfidence: 0.5, pickId: sealedPickId }; // grade destroyed the byte
}

function writeManifest(root: string, grandfathered: unknown[]): void {
  fs.writeFileSync(
    path.join(warplineDirOf(root), 'fabric-legacy.json'),
    JSON.stringify({ reason: 'containment test', grandfathered }, null, 2),
    'utf8',
  );
}

function pinOf(s: Strand): { pickId: string; bodyHash: string } {
  const { pickId, ...body } = s;
  return { pickId, bodyHash: computeLegacyBodyHash(body) };
}

function rawRewrite(root: string, strands: Strand[]): void {
  fs.writeFileSync(
    path.join(warplineDirOf(root), 'fabric.jsonl'),
    strands.map((s) => JSON.stringify(s)).join('\n') + '\n',
    'utf8',
  );
}

describe('grandfather containment — the pinned body is tamper-evident', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-gfc-'));
    wdir = warplineDirOf(root);
    appendStrand(wdir, v1Strand(0));
    appendStrand(wdir, gradedOver(1));
    writeManifest(root, [pinOf(readFabric(wdir)[1])]);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('untampered: soft legacy-unverifiable, exit-equivalent 0', () => {
    // requireAnchor:false isolates grandfather containment from the v1-anchor coverage
    // gate (this fixture is an unanchored v1 fabric by design).
    const r = verifyFabric(root, { requireAnchor: false });
    expect(r.failures).toEqual([]);
    expect(r.legacyUnverifiable.count).toBe(1);
  });

  it('tampering a grandfathered strand INTENT → HARD legacy-body-mismatch + rewriteFabric throws', () => {
    const fabric = readFabric(wdir);
    const tampered = fabric.map((s) => (s.seq === 1 ? { ...s, intent: 'FORGED under the grandfather clause' } : s));
    rawRewrite(root, tampered);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'legacy-body-mismatch')).toBe(true);
    expect(r.legacyUnverifiable.count).toBe(0); // hard, NOT soft
    expect(r.v1Prefix.selfHashOk).toBe(false);
    expect(() => rewriteFabric(wdir, tampered)).toThrow(/grandfathered strand seq 1 body hash/);
  });

  it('tampering a grandfathered strand DELTA → HARD legacy-body-mismatch + rewriteFabric throws', () => {
    const fabric = readFabric(wdir);
    const tampered = fabric.map((s) =>
      s.seq === 1 ? { ...s, delta: { ...s.delta, born: ['#injected-symbol'] } } : s,
    );
    rawRewrite(root, tampered);
    expect(verifyFabric(root).failures.some((f) => f.seq === 1 && f.kind === 'legacy-body-mismatch')).toBe(true);
    expect(() => rewriteFabric(wdir, tampered)).toThrow(/only calibratedConfidence is rewritable/);
  });

  it('a confidence-only change on a grandfathered strand stays LEGAL (grade path)', async () => {
    const fabric = readFabric(wdir);
    // Direct rewrite with only the confidence moved — the §7.4 guard passes.
    const graded = fabric.map((s) => (s.seq === 1 ? { ...s, calibratedConfidence: 0.9 } : s));
    expect(() => rewriteFabric(wdir, graded)).not.toThrow();
    // And the full grade loop over the fixture succeeds end-to-end.
    const report = gradeFabric(root, { window: 1 });
    await expect(applyGrades(root, report, NOW)).resolves.toBeUndefined();
    expect(readFabric(wdir).map((s) => s.pickId)).toEqual(fabric.map((s) => s.pickId));
  });
});

describe('grandfather containment — v1-only + manifest membership sanity', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-gfc-manifest-'));
    wdir = warplineDirOf(root);
    appendStrand(wdir, v1Strand(0));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a v2 pickId in the legacy file is IGNORED for verification and REPORTED as invalid', () => {
    // A v2 strand chained onto the v1 genesis.
    const fabric = readFabric(wdir);
    const v2body: StrandBody = {
      schemaVersion: 2,
      seq: 1,
      parentPickId: fabric[0].pickId,
      authoredBy: { agentId: 'arky' },
      stateId: 'state:v0:v2',
      parentStateId: fabric[0].stateId,
      actor: 'ascend',
      intent: 'v2 strand',
      recordedAt: NOW,
      objectCount: 6,
      delta: { born: ['#x'], retired: [], contractChanged: [], renamedNoop: 0 },
      calibratedConfidence: null,
      provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    };
    const v2strand: Strand = { ...v2body, pickId: computePickId(v2body) };
    appendStrand(wdir, v2strand);
    writeManifest(root, [pinOf(v2strand)]);
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.kind === 'legacy-manifest-invalid' && f.pickId === v2strand.pickId)).toBe(true);
    expect(r.legacyUnverifiable.count).toBe(0); // never soft-passed

    // And the clause never applies at verify step 1: forge the v2 strand's intent —
    // it is a HARD pickId-mismatch even though its pickId sits in the manifest.
    rawRewrite(root, [fabric[0], { ...v2strand, intent: 'FORGED v2' }]);
    const r2 = verifyFabric(root);
    expect(r2.failures.some((f) => f.seq === 1 && f.kind === 'pickId-mismatch')).toBe(true);
  });

  it('a manifest entry matching NO strand → legacy-manifest-invalid (seq -1)', () => {
    writeManifest(root, [{ pickId: 'pick:v0:' + 'a'.repeat(64), bodyHash: 'sha256:' + 'b'.repeat(64) }]);
    const r = verifyFabric(root);
    const f = r.failures.find((x) => x.kind === 'legacy-manifest-invalid');
    expect(f).toBeDefined();
    expect(f!.seq).toBe(-1);
    expect(f!.detail).toMatch(/matches NO strand/);
  });

  it('the retired bare-pickId manifest format FAILS CLOSED with a regenerate instruction', () => {
    writeManifest(root, ['pick:v0:' + 'c'.repeat(64)]); // old format
    expect(() => readLegacyGrandfathered(wdir)).toThrow(/retired bare-pickId format.*regenerate/s);
    expect(() => verifyFabric(root)).toThrow(/regenerate the legacy manifest/);
    expect(() => rewriteFabric(wdir, readFabric(wdir))).toThrow(/regenerate the legacy manifest/);
  });
});

describe('grandfather containment — the REAL migrated manifest', () => {
  it('the repo manifest is body-pinned {pickId, bodyHash} and loads cleanly', () => {
    const realWdir = path.join(new URL('../../../', import.meta.url).pathname, '.warpline');
    const map = readLegacyGrandfathered(realWdir);
    expect(map.size).toBe(7);
    for (const [pickId, bodyHash] of map) {
      expect(pickId).toMatch(/^pick:v0:[0-9a-f]{64}$/);
      expect(bodyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    // Each pinned hash matches the CURRENT fabric's strand body (migration correctness).
    const fabric = readFabric(realWdir);
    for (const [pickId, bodyHash] of map) {
      const s = fabric.find((x) => x.pickId === pickId)!;
      expect(s).toBeDefined();
      expect(s.schemaVersion).toBeLessThan(2);
      const { pickId: _p, ...body } = s;
      expect(computeLegacyBodyHash(body)).toBe(bodyHash);
    }
  });
});

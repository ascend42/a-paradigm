/**
 * fabric-legacy.test — the grandfathering contract (§7, TD-2026-07-01-202). A strand
 * whose stored pickId reproduces under NO known rule (a graded-over whole-body strand)
 * is a HARD `pickId-mismatch` UNLESS its pickId is listed in .warpline/fabric-legacy.json,
 * in which case it is a SOFT `legacy-unverifiable` (exit stays 0). And `grade` still
 * runs over the REAL fabric because the §7.4 guard skips the grandfathered set.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { warplineDirOf, appendStrand, readFabric } from '../src/fabric/fabric.js';
import { gradeFabric, applyGrades } from '../src/fabric/grade.js';
import { computePickId, computePickIdWholeBody, type Strand, type StrandBody } from '../src/fabric/strand.js';
import { verifyFabric } from '../src/fabric/verify.js';

const NOW = '2026-07-01T00:00:00.000Z';
const REAL_WDIR = path.join(fileURLToPath(new URL('../../../', import.meta.url)), '.warpline');

/** A clean exclusion-rule v1 genesis (reproduces under the current rule). */
function v1Genesis(): Strand {
  const body: StrandBody = {
    schemaVersion: 1,
    seq: 0,
    stateId: 'state:v0:genesis',
    parentStateId: null,
    actor: 'ascend',
    intent: 'genesis',
    recordedAt: NOW,
    objectCount: 5,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
  };
  return { ...body, pickId: computePickId(body) };
}

/**
 * A strand sealed under the RETIRED whole-body rule (confidence IN the hash), then
 * #grade overwrote its calibratedConfidence in place — so it reproduces under NO
 * known rule today. This is exactly the seq 1–7 situation.
 */
function gradedOverWholeBody(): Strand {
  const sealBody: StrandBody = {
    schemaVersion: 1,
    seq: 1,
    stateId: 'state:v0:seq1',
    parentStateId: 'state:v0:genesis',
    actor: 'ascend',
    intent: 'seq 1 sealed under whole-body, then graded',
    recordedAt: NOW,
    objectCount: 6,
    delta: { born: ['#a'], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: 0.8, // the SEED that was hashed at seal
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
  };
  const sealedPickId = computePickIdWholeBody(sealBody); // the immutable stored id
  // grade overwrote the confidence 0.8 → 0.5, destroying the hashed byte.
  return { ...sealBody, calibratedConfidence: 0.5, pickId: sealedPickId };
}

function writeLegacy(root: string, grandfathered: string[]): void {
  fs.writeFileSync(
    path.join(warplineDirOf(root), 'fabric-legacy.json'),
    JSON.stringify({ reason: 'test grandfather', grandfathered }, null, 2),
    'utf8',
  );
}

describe('fabric-legacy — hard vs soft classification of a graded-over strand', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-legacy-'));
    const wdir = warplineDirOf(root);
    appendStrand(wdir, v1Genesis());
    appendStrand(wdir, gradedOverWholeBody());
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('NOT grandfathered → pickId-mismatch (hard, real tamper — non-zero exit)', () => {
    const r = verifyFabric(root); // no fabric-legacy.json
    expect(r.legacyUnverifiable.count).toBe(0);
    expect(r.failures.some((f) => f.seq === 1 && f.kind === 'pickId-mismatch')).toBe(true);
    expect(r.v1Prefix.selfHashOk).toBe(false);
  });

  it('grandfathered by pickId → legacy-unverifiable (soft, exit stays 0)', () => {
    const graded = readFabric(warplineDirOf(root)).find((s) => s.seq === 1)!;
    writeLegacy(root, [graded.pickId]);
    const r = verifyFabric(root);
    expect(r.failures).toEqual([]); // soft — exit 0
    expect(r.legacyUnverifiable).toEqual({ count: 1, pickIds: [graded.pickId] });
    expect(r.v1Prefix.selfHashOk).toBe(true); // genesis rule-verified, seq 1 grandfathered
  });

  it('the genesis (a real known-rule strand) is NEVER grandfathered away — a tamper on it still surfaces', () => {
    const fabric = readFabric(warplineDirOf(root));
    writeLegacy(root, [fabric[1].pickId]); // grandfather only seq 1
    fabric[0] = { ...fabric[0], intent: 'TAMPERED genesis' }; // corrupt seq 0, keep pickId
    fs.writeFileSync(warplineDirOf(root) + '/fabric.jsonl', fabric.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
    const r = verifyFabric(root);
    expect(r.failures.some((f) => f.seq === 0 && f.kind === 'pickId-mismatch')).toBe(true);
  });
});

describe('fabric-legacy — grade runs over the REAL fabric (guard skips the grandfathered residue)', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-legacy-grade-'));
    const wdir = warplineDirOf(root);
    fs.mkdirSync(path.join(wdir, 'refs'), { recursive: true });
    fs.copyFileSync(path.join(REAL_WDIR, 'fabric.jsonl'), path.join(wdir, 'fabric.jsonl'));
    fs.copyFileSync(path.join(REAL_WDIR, 'fabric-legacy.json'), path.join(wdir, 'fabric-legacy.json'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('gradeFabric + applyGrades SUCCEED and leave every pickId untouched', async () => {
    const pickIdsBefore = readFabric(warplineDirOf(root)).map((s) => s.pickId);
    const report = gradeFabric(root, { window: 2 });
    await expect(applyGrades(root, report, NOW)).resolves.toBeUndefined(); // §7.4 guard does NOT throw on seq 1–7
    expect(readFabric(warplineDirOf(root)).map((s) => s.pickId)).toEqual(pickIdsBefore);
  });
});

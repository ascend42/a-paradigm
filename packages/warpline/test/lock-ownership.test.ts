/**
 * lock-ownership.test — Move 2 item 4 (Judge's net-new finding). The fabric lock
 * carries an OWNER TOKEN: after a steal, the old (slow) holder's release must NOT
 * delete the new holder's lockfile (the cascading multi-holder bug), and the steal
 * claims the stale file atomically (rename-aside) instead of a blind unlink. And
 * rewriteFabric carries a lost-update CAS: racing an append can never silently
 * drop a strand off the ledger.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  acquireFabricLock,
  releaseFabricLock,
  withFabricLock,
} from '../src/fabric/lock.js';
import { warplineDirOf, appendStrand, readFabric, rewriteFabric } from '../src/fabric/fabric.js';
import { computePickId, type Strand, type StrandBody } from '../src/fabric/strand.js';

const NOW = '2026-07-01T00:00:00.000Z';

function v1Strand(seq: number, over: Partial<StrandBody> = {}): Strand {
  const body: StrandBody = {
    schemaVersion: 1,
    seq,
    stateId: `state:v0:l${seq}`,
    parentStateId: seq === 0 ? null : `state:v0:l${seq - 1}`,
    actor: 'ascend',
    intent: `lock seq ${seq}`,
    recordedAt: NOW,
    objectCount: 3,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    ...over,
  };
  return { ...body, pickId: computePickId(body) };
}

describe('fabric lock — owner token + steal safety', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-lock-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('acquire writes the owner token; release removes only our own lock', async () => {
    const h = await acquireFabricLock(root);
    expect(fs.readFileSync(h.path, 'utf8').startsWith(h.token + ' ')).toBe(true);
    releaseFabricLock(h);
    expect(fs.existsSync(h.path)).toBe(false);
  });

  it('after a steal, the OLD holder release does NOT remove the NEW holder lock', async () => {
    const h1 = await acquireFabricLock(root);
    // Simulate a crashed/stalled holder: age the lockfile past the stale TTL.
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(h1.path, old, old);

    const h2 = await acquireFabricLock(root); // steals the stale lock
    expect(h2.token).not.toBe(h1.token);
    expect(fs.readFileSync(h2.path, 'utf8').startsWith(h2.token + ' ')).toBe(true);

    // The slow original holder finally releases — it must leave h2's lock alone
    // (pre-fix, this unconditional unlink cascaded into multi-holder).
    releaseFabricLock(h1);
    expect(fs.existsSync(h2.path)).toBe(true);
    expect(fs.readFileSync(h2.path, 'utf8').startsWith(h2.token + ' ')).toBe(true);

    releaseFabricLock(h2); // the rightful owner still releases cleanly
    expect(fs.existsSync(h2.path)).toBe(false);
  });

  it('withFabricLock still round-trips (acquire → fn → release)', async () => {
    const lp = path.join(warplineDirOf(root), 'refs', '.lock');
    const result = await withFabricLock(root, () => {
      expect(fs.existsSync(lp)).toBe(true);
      return 42;
    });
    expect(result).toBe(42);
    expect(fs.existsSync(lp)).toBe(false);
  });
});

describe('rewriteFabric — lost-update CAS (never drop a strand racing an append)', () => {
  let root: string;
  let wdir: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-rewrite-cas-'));
    wdir = warplineDirOf(root);
    appendStrand(wdir, v1Strand(0));
    appendStrand(wdir, v1Strand(1));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('a concurrent APPEND between read and rewrite → CAS throws, nothing dropped', () => {
    // The racing grader: reads the 2-strand ledger, computes its rewrite…
    const snapshot = readFabric(wdir);
    const graded = snapshot.map((s) => (s.seq === 1 ? { ...s, calibratedConfidence: 0.9 } : s));
    // …meanwhile a concurrent writer seals strand 2.
    appendStrand(wdir, v1Strand(2));
    // Pre-fix, this rename-over would silently DROP seq 2. Now it fails closed…
    expect(() => rewriteFabric(wdir, graded)).toThrow(/rewriteFabric CAS failed/);
    // …and the appended strand is still on the ledger.
    expect(readFabric(wdir).map((s) => s.seq)).toEqual([0, 1, 2]);
  });

  it('a concurrent identity change (same length, different pick) → CAS throws', () => {
    const snapshot = readFabric(wdir);
    const graded = snapshot.map((s) => (s.seq === 1 ? { ...s, calibratedConfidence: 0.9 } : s));
    // The on-disk seq-1 strand is replaced by a DIFFERENT (self-consistent) strand.
    const replaced = [snapshot[0], v1Strand(1, { intent: 'a different pick entirely' })];
    fs.writeFileSync(
      path.join(wdir, 'fabric.jsonl'),
      replaced.map((s) => JSON.stringify(s)).join('\n') + '\n',
      'utf8',
    );
    expect(() => rewriteFabric(wdir, graded)).toThrow(/rewriteFabric CAS failed/);
  });

  it('the un-raced path still rewrites (confidence-only, pick-for-pick identical)', () => {
    const snapshot = readFabric(wdir);
    const graded = snapshot.map((s) => (s.seq === 1 ? { ...s, calibratedConfidence: 0.9 } : s));
    expect(() => rewriteFabric(wdir, graded)).not.toThrow();
    expect(readFabric(wdir).find((s) => s.seq === 1)!.calibratedConfidence).toBe(0.9);
  });
});

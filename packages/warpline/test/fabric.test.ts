/**
 * fabric.test — the Phase-2 native WRITE PATH.
 *   - strand: pickId is deterministic and content-sensitive
 *   - fabric: selvage round-trips (atomic) and the ledger appends/reads
 *   - store.loadState: a persisted state rehydrates faithfully (diff → zero)
 *   - recordPick: genesis → advance-on-change → no-op-when-unchanged, against a
 *     real fixture dir, writing ONLY under .warpline/ (never git)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { absorb } from '../src/absorb.js';
import { diff } from '../src/sem-delta.js';
import { WarpStore } from '../src/warp/store.js';
import { computePickId, type StrandBody } from '../src/fabric/strand.js';
import {
  warplineDirOf,
  readSelvage,
  writeSelvage,
  appendStrand,
  readFabric,
} from '../src/fabric/fabric.js';
import { recordPick } from '../src/fabric/pick.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-fabric-'));
}

const FIXED_NOW = '2026-06-25T00:00:00.000Z';

function sampleBody(over: Partial<StrandBody> = {}): StrandBody {
  return {
    schemaVersion: 1,
    seq: 0,
    stateId: 'state:v0:abc',
    parentStateId: null,
    actor: 'tester',
    intent: 'genesis',
    recordedAt: FIXED_NOW,
    objectCount: 3,
    delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
    calibratedConfidence: null,
    provenance: { ref: 'WORKTREE', treeSha: null, gitCommit: null },
    ...over,
  };
}

describe('strand · computePickId', () => {
  it('is deterministic for identical bodies', () => {
    expect(computePickId(sampleBody())).toBe(computePickId(sampleBody()));
  });

  it('changes when any body field changes', () => {
    const base = computePickId(sampleBody());
    expect(computePickId(sampleBody({ intent: 'something else' }))).not.toBe(base);
    expect(computePickId(sampleBody({ actor: 'other' }))).not.toBe(base);
    expect(computePickId(sampleBody({ stateId: 'state:v0:xyz' }))).not.toBe(base);
  });

  it('mints a pick:v0: address', () => {
    expect(computePickId(sampleBody()).startsWith('pick:v0:')).toBe(true);
  });
});

describe('fabric · selvage + ledger', () => {
  let root: string;
  beforeEach(() => {
    root = mkTmp();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('selvage round-trips and overwrites atomically', () => {
    const wdir = warplineDirOf(root);
    expect(readSelvage(wdir)).toBeNull();
    writeSelvage(wdir, 'state:v0:one');
    expect(readSelvage(wdir)).toBe('state:v0:one');
    writeSelvage(wdir, 'state:v0:two');
    expect(readSelvage(wdir)).toBe('state:v0:two');
    // no leftover tmp file
    expect(fs.existsSync(path.join(wdir, 'refs', 'selvage.tmp'))).toBe(false);
  });

  it('appends and reads strands in seal order', () => {
    const wdir = warplineDirOf(root);
    expect(readFabric(wdir)).toEqual([]);
    const a = { ...sampleBody(), pickId: computePickId(sampleBody()) };
    const b1 = sampleBody({ seq: 1, intent: 'second', stateId: 'state:v0:two' });
    const b = { ...b1, pickId: computePickId(b1) };
    appendStrand(wdir, a);
    appendStrand(wdir, b);
    const read = readFabric(wdir);
    expect(read.map((s) => s.seq)).toEqual([0, 1]);
    expect(read[1].intent).toBe('second');
  });
});

describe('store · loadState rehydration', () => {
  it('a persisted state reads back faithfully (diff → zero)', async () => {
    const root = mkTmp();
    try {
      const state = await absorb('HEAD');
      const store = new WarpStore(root, { diskCache: true });
      store.putState(state);
      // fresh store instance (cold in-mem map) must read it back from disk
      const cold = new WarpStore(root, { diskCache: true });
      const loaded = cold.loadState(state.stateId);
      expect(loaded).toBeDefined();
      expect(loaded!.stateId).toBe(state.stateId);
      expect(loaded!.objects.size).toBe(state.objects.size);
      const d = diff(state, loaded!);
      expect(d.deltas.size).toBe(0);
      expect(d.renames.length).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('recordPick · the write path (genesis → advance → no-op)', () => {
  let root: string;
  beforeEach(() => {
    root = mkTmp();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writePurpose(components: string): void {
    fs.writeFileSync(
      path.join(root, '.purpose'),
      `version: "2.0"\ndescription: Fabric fixture\ncomponents:\n${components}`,
      'utf8',
    );
  }

  it('genesis seals seq 0 with a null parent and advances the selvage', async () => {
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n  beta:\n    description: Beta\n    type: module\n');
    const r = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: FIXED_NOW });
    expect(r.noop).toBe(false);
    expect(r.isGenesis).toBe(true);
    expect(r.strand!.seq).toBe(0);
    expect(r.strand!.parentStateId).toBeNull();
    expect(r.strand!.objectCount).toBeGreaterThan(0);
    // selvage now points at the sealed state
    expect(readSelvage(warplineDirOf(root))).toBe(r.stateId);
    expect(readFabric(warplineDirOf(root))).toHaveLength(1);
  });

  it('a meaning change seals seq 1 with the parent and a non-empty delta', async () => {
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
    const g = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: FIXED_NOW });

    // add a structurally-distinct component (type cli ≠ module) → a born symbol
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n  gamma:\n    description: Gamma\n    type: cli\n');
    const r = await recordPick(root, { cwd: root, intent: 'add gamma', actor: 'tester', now: FIXED_NOW });

    expect(r.noop).toBe(false);
    expect(r.isGenesis).toBe(false);
    expect(r.strand!.seq).toBe(1);
    expect(r.strand!.parentStateId).toBe(g.stateId);
    const born = r.strand!.delta.born.join(',');
    expect(born).toMatch(/gamma/);
    expect(readSelvage(warplineDirOf(root))).toBe(r.stateId);
    expect(readFabric(warplineDirOf(root))).toHaveLength(2);
  });

  it('records a structurally-identical added symbol (stateId dedups, diff does not)', async () => {
    // alpha and delta have IDENTICAL essence (same empty module), so the deduped
    // stateId is unchanged — but the diff (keyed by stableKey) sees delta born.
    // A stateId-equality no-op check would WRONGLY drop this; the diff-based one
    // must record it.
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
    await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: FIXED_NOW });
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n  delta:\n    description: Delta\n    type: module\n');
    const r = await recordPick(root, { cwd: root, intent: 'add identical-essence delta', actor: 'tester', now: FIXED_NOW });
    expect(r.noop).toBe(false);
    expect(r.strand!.delta.born).toContain('#delta');
    expect(readFabric(warplineDirOf(root))).toHaveLength(2);
  });

  it('no-ops when meaning is unchanged since selvage (provable-zero)', async () => {
    writePurpose('  alpha:\n    description: Alpha\n    type: module\n');
    const g = await recordPick(root, { cwd: root, intent: 'genesis', actor: 'tester', now: FIXED_NOW });
    const again = await recordPick(root, { cwd: root, intent: 'no change', actor: 'tester', now: FIXED_NOW });
    expect(again.noop).toBe(true);
    expect(again.stateId).toBe(g.stateId);
    // fabric did not grow
    expect(readFabric(warplineDirOf(root))).toHaveLength(1);
  });
});
